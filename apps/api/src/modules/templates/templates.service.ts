import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, BadGatewayException, OnModuleInit } from '@nestjs/common';
import { Prisma, type Template } from '@prisma/client';
import {
  editorToComponents,
  extractVariables,
  hasOptOutButton,
  isOptOutButtonText,
  validateTemplateEditor,
  type TemplateComponent,
  type TemplateEditorDto,
  type TemplateDto,
  type WaTemplate,
} from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DomainEvents } from '../events/domain-events.service';
import { RealtimeService } from '../realtime/realtime.gateway';
import { StorageService } from '../storage/storage.service';
import { WhatsAppApiError, WhatsAppGateway } from '../whatsapp/whatsapp.gateway';
import { mapMetaCategory, mapMetaStatus, rejectionReasonEs, toTemplateDto } from './templates.mapper';

export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  deleted: number;
}

export interface TemplateDraft {
  sourceTemplateId: string;
  draft: TemplateEditorDto;
  /** avisos para la persona que edita (p. ej. volver a subir la imagen de ejemplo) */
  notes: string[];
}

const HEADER_MIME: Record<string, RegExp> = { IMAGE: /^image\/(jpeg|png)$/, VIDEO: /^video\/(mp4|3gpp)$/, DOCUMENT: /^application\/pdf$/ };
const HEADER_MIME_ES: Record<string, string> = { IMAGE: 'una imagen JPG o PNG', VIDEO: 'un vídeo MP4', DOCUMENT: 'un PDF' };

@Injectable()
export class TemplatesService implements OnModuleInit {
  private readonly log = new Logger('Templates');
  private syncing: Promise<SyncResult> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: WhatsAppGateway,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Recalcula `hasOptOutButton` de todas las plantillas guardadas con el detector actual (texto exacto, no
   * subcadena): las que se marcaron por error con «Ver rebajas» & co. dejan de valer para campañas.
   */
  async onModuleInit() {
    try {
      await this.recomputeOptOutFlags();
    } catch (e) {
      this.log.warn(`No se pudo recalcular el botón de baja de las plantillas: ${(e as Error).message}`);
    }
  }

  async recomputeOptOutFlags(): Promise<number> {
    const rows = await this.prisma.template.findMany({ select: { id: true, components: true, hasOptOutButton: true } });
    let fixed = 0;
    for (const r of rows) {
      const has = hasOptOutButton((r.components ?? []) as unknown as TemplateComponent[]);
      if (has !== r.hasOptOutButton) {
        await this.prisma.template.update({ where: { id: r.id }, data: { hasOptOutButton: has } });
        fixed++;
      }
    }
    if (fixed) this.log.log(`Botón de baja recalculado en ${fixed} plantilla(s)`);
    return fixed;
  }

  // ───────── consulta ─────────

  async list(q: { status?: string; category?: string; q?: string; language?: string }): Promise<TemplateDto[]> {
    const statuses = q.status ? q.status.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
    const where: Prisma.TemplateWhereInput = {
      status: statuses ? { in: statuses as any } : { not: 'DELETED' },
      category: q.category ? (q.category.toUpperCase() as any) : undefined,
      language: q.language || undefined,
      OR: q.q?.trim()
        ? [{ name: { contains: q.q.trim(), mode: 'insensitive' } }, { displayName: { contains: q.q.trim(), mode: 'insensitive' } }]
        : undefined,
    };
    const rows = await this.prisma.template.findMany({ where, orderBy: [{ updatedAt: 'desc' }] });
    return rows.map(toTemplateDto);
  }

  async getRow(id: string): Promise<Template> {
    const t = await this.prisma.template.findUnique({ where: { id } });
    if (!t) throw new NotFoundException({ statusCode: 404, message: 'Plantilla no encontrada' });
    return t;
  }

  async get(id: string): Promise<TemplateDto> {
    return toTemplateDto(await this.getRow(id));
  }

  // ───────── sincronización (RF-4.1) ─────────

  /** Sincroniza con Meta. Si ya hay una en curso, devuelve esa misma. */
  sync(userId?: string | null): Promise<SyncResult> {
    if (!this.syncing) {
      this.syncing = this.doSync()
        .then(async (r) => {
          if (userId) await this.audit.log({ userId, action: 'sync_templates', entityType: 'Template', data: r });
          return r;
        })
        .finally(() => {
          this.syncing = null;
        });
    }
    return this.syncing;
  }

  private async doSync(): Promise<SyncResult> {
    let remote: WaTemplate[];
    try {
      remote = await this.gateway.listTemplates();
    } catch (e) {
      throw this.metaError(e, 'No se pudieron leer las plantillas de Meta');
    }
    const res: SyncResult = { total: remote.length, created: 0, updated: 0, deleted: 0 };
    const now = new Date();
    const seen = new Set<string>();
    for (const w of remote) {
      const existing =
        (await this.prisma.template.findUnique({ where: { metaTemplateId: String(w.id) } })) ??
        (await this.prisma.template.findUnique({ where: { name_language: { name: w.name, language: w.language } } }));
      const components = (w.components ?? []) as TemplateComponent[];
      const status = mapMetaStatus(w.status);
      const data = {
        metaTemplateId: String(w.id),
        name: w.name,
        language: w.language,
        category: mapMetaCategory(w.category),
        status,
        components: components as unknown as Prisma.InputJsonValue,
        rejectedReason: status === 'REJECTED' ? rejectionReasonEs(w.rejected_reason) ?? 'Meta no ha indicado el motivo' : null,
        qualityScore: w.quality_score?.score ?? null,
        hasOptOutButton: hasOptOutButton(components),
        lastSyncedAt: now,
      };
      if (!existing) {
        const row = await this.prisma.template.create({ data });
        seen.add(row.id);
        res.created++;
      } else {
        seen.add(existing.id);
        const row = await this.prisma.template.update({ where: { id: existing.id }, data });
        res.updated++;
        await this.notifyChange(row, existing.status);
      }
    }
    // Las que ya no están en Meta → DELETED (los borradores locales no se tocan)
    const gone = await this.prisma.template.findMany({ where: { id: { notIn: [...seen] }, status: { notIn: ['DELETED', 'LOCAL_DRAFT'] } } });
    for (const g of gone) {
      const row = await this.prisma.template.update({ where: { id: g.id }, data: { status: 'DELETED', lastSyncedAt: now } });
      res.deleted++;
      await this.notifyChange(row, g.status);
    }
    return res;
  }

  /** Emite el evento interno y el de tiempo real si el estado cambió. */
  async notifyChange(row: Template, previousStatus: string | null, extra: { force?: boolean; status?: string } = {}) {
    const status = extra.status ?? row.status;
    if (!extra.force && previousStatus === status) return;
    await this.events.emit('template.status', {
      templateId: row.id,
      name: row.name,
      status,
      previousStatus,
      reason: row.rejectedReason,
    });
    this.realtime.emit('template.updated', { templateId: row.id, status });
  }

  // ───────── crear y enviar a revisión (RF-4.2) ─────────

  async create(dto: TemplateEditorDto, userId: string): Promise<TemplateDto> {
    const errors = validateTemplateEditor(dto);
    if (errors.length) {
      throw new BadRequestException({ statusCode: 400, message: errors[0], code: 'VALIDATION', details: errors.map((message) => ({ message })) });
    }
    const dup = await this.prisma.template.findUnique({ where: { name_language: { name: dto.name, language: dto.language } } });
    if (dup) {
      throw new ConflictException({
        statusCode: 409,
        message:
          dup.status === 'DELETED'
            ? 'Ese nombre ya se usó en una plantilla borrada y Meta no deja reutilizarlo durante un tiempo. Elige otro nombre.'
            : 'Ya existe una plantilla con ese nombre en ese idioma. Cambia el nombre.',
      });
    }

    let headerHandle: string | undefined;
    if (dto.header.format === 'IMAGE' || dto.header.format === 'VIDEO' || dto.header.format === 'DOCUMENT') {
      headerHandle = await this.uploadHeaderExample(dto.header.format, dto.header.exampleMediaFileId!);
    }
    const components = editorToComponents(dto, { headerHandle });

    let created: { id: string; status: string; category: string };
    try {
      created = await this.gateway.createTemplate({ name: dto.name, language: dto.language, category: dto.category, components });
    } catch (e) {
      throw this.metaError(e, 'Meta no ha aceptado la plantilla');
    }
    const row = await this.prisma.template.create({
      data: {
        metaTemplateId: created.id ? String(created.id) : null,
        name: dto.name,
        displayName: dto.displayName,
        language: dto.language,
        category: mapMetaCategory(created.category ?? dto.category),
        status: mapMetaStatus(created.status ?? 'PENDING'),
        components: components as unknown as Prisma.InputJsonValue,
        hasOptOutButton: hasOptOutButton(components),
        lastSyncedAt: new Date(),
        createdById: userId,
      },
    });
    await this.audit.log({
      userId,
      action: 'create_template',
      entityType: 'Template',
      entityId: row.id,
      data: { name: row.name, category: row.category, language: row.language, optOutButton: row.hasOptOutButton },
    });
    this.realtime.emit('template.updated', { templateId: row.id, status: row.status });
    return toTemplateDto(row);
  }

  private async uploadHeaderExample(format: string, mediaFileId: string): Promise<string> {
    const media = await this.prisma.mediaFile.findUnique({ where: { id: mediaFileId } });
    if (!media) throw new BadRequestException({ statusCode: 400, message: 'El archivo de ejemplo de la cabecera no existe. Vuelve a subirlo.' });
    if (!HEADER_MIME[format]!.test(media.mimeType)) {
      throw new BadRequestException({ statusCode: 400, message: `El ejemplo de la cabecera debe ser ${HEADER_MIME_ES[format]}` });
    }
    let data: Buffer;
    try {
      data = await this.storage.download(media.storagePath);
    } catch {
      throw new BadRequestException({ statusCode: 400, message: 'No se pudo leer el archivo de ejemplo. Vuelve a subirlo.' });
    }
    try {
      return await this.gateway.resumableUpload(data, media.mimeType, media.fileName ?? `ejemplo.${media.mimeType.split('/')[1] ?? 'bin'}`);
    } catch (e) {
      throw this.metaError(e, 'No se pudo subir el ejemplo de la cabecera a Meta');
    }
  }

  // ───────── duplicar y borrar ─────────

  /** Borrador para el editor a partir de una plantilla existente (no crea nada en Meta). */
  async duplicate(id: string): Promise<TemplateDraft> {
    const t = await this.getRow(id);
    if (t.category === 'AUTHENTICATION') {
      throw new BadRequestException({ statusCode: 400, message: 'Las plantillas de autenticación no se pueden duplicar desde aquí' });
    }
    const comps = t.components as unknown as TemplateComponent[];
    const notes: string[] = [];
    const header = comps.find((c) => c.type === 'HEADER');
    const body = comps.find((c) => c.type === 'BODY');
    const footer = comps.find((c) => c.type === 'FOOTER');
    const btns = comps.find((c) => c.type === 'BUTTONS')?.buttons ?? [];

    const d: TemplateEditorDto = {
      displayName: '',
      name: '',
      category: t.category === 'UTILITY' ? 'UTILITY' : 'MARKETING',
      language: t.language,
      header: { format: 'NONE' },
      body: body?.text ?? '',
      bodyExamples: body?.example?.body_text?.[0] ?? [],
      footer: footer?.text,
      buttons: [],
      addOptOutButton: true,
    };
    if (header?.format === 'TEXT') {
      d.header = { format: 'TEXT', text: header.text, textExample: header.example?.header_text?.[0] };
    } else if (header?.format === 'IMAGE' || header?.format === 'VIDEO' || header?.format === 'DOCUMENT') {
      d.header = { format: header.format };
      notes.push(`Sube de nuevo el ${header.format === 'IMAGE' ? 'imagen' : header.format === 'VIDEO' ? 'vídeo' : 'documento'} de ejemplo de la cabecera.`);
    }
    if (extractVariables(d.body).length && !d.bodyExamples.length) notes.push('Escribe el ejemplo de cada variable del mensaje.');
    let hadOptOut = false;
    for (const b of btns) {
      if (b.type === 'QUICK_REPLY') {
        if (isOptOutButtonText(b.text)) {
          hadOptOut = true;
          continue; // se vuelve a añadir con la casilla
        }
        d.buttons.push({ type: 'QUICK_REPLY', text: b.text });
      } else if (b.type === 'URL' && b.url) {
        d.buttons.push({ type: 'URL', text: b.text, url: b.url, example: b.example?.[0] });
      } else if (b.type === 'PHONE_NUMBER' && b.phone_number) {
        d.buttons.push({ type: 'PHONE_NUMBER', text: b.text, phone: b.phone_number });
      } else notes.push(`El botón «${b.text}» (${b.type}) no se puede copiar; añádelo a mano si lo necesitas.`);
    }
    d.addOptOutButton = d.category === 'MARKETING' ? true : hadOptOut;
    if (d.category === 'MARKETING' && !hadOptOut) notes.push('Se ha añadido el botón «No recibir más», obligatorio en Marketing.');

    // nombre libre: <base>_v2, _v3…
    const base = t.name.replace(/_v\d+$/, '');
    let n = Number(/_v(\d+)$/.exec(t.name)?.[1] ?? 1) + 1;
    for (; n < 100; n++) {
      const taken = await this.prisma.template.findUnique({ where: { name_language: { name: `${base}_v${n}`, language: t.language } } });
      if (!taken) break;
    }
    d.name = `${base}_v${n}`;
    d.displayName = `${(t.displayName ?? t.name.replace(/_/g, ' ')).replace(/ v\d+$/, '')} v${n}`;
    return { sourceTemplateId: t.id, draft: d, notes };
  }

  async remove(id: string, userId: string): Promise<{ ok: true }> {
    const t = await this.getRow(id);
    if (t.status === 'DELETED') return { ok: true };
    const active = await this.prisma.campaign.count({ where: { templateId: id, status: { in: ['SCHEDULED', 'RUNNING', 'PAUSED'] } } });
    if (active) {
      throw new ConflictException({ statusCode: 409, message: 'Hay campañas programadas, en curso o en pausa que usan esta plantilla. Cancélalas antes de borrarla.' });
    }
    if (t.status !== 'LOCAL_DRAFT') {
      try {
        await this.gateway.deleteTemplate(t.name, t.metaTemplateId ?? undefined);
      } catch (e) {
        if (!(e instanceof WhatsAppApiError && e.httpStatus === 404)) throw this.metaError(e, 'Meta no ha podido borrar la plantilla');
      }
    }
    const row = await this.prisma.template.update({ where: { id }, data: { status: 'DELETED', lastSyncedAt: new Date() } });
    await this.audit.log({ userId, action: 'delete_template', entityType: 'Template', entityId: id, data: { name: t.name, previousStatus: t.status } });
    await this.notifyChange(row, t.status);
    return { ok: true };
  }

  // ───────── webhooks (RF-4.4) ─────────

  private async findForWebhook(value: any): Promise<Template | null> {
    const metaId = value?.message_template_id != null ? String(value.message_template_id) : null;
    const name: string | undefined = value?.message_template_name;
    const language: string | undefined = value?.message_template_language;
    const find = async () => {
      if (metaId) {
        const byId = await this.prisma.template.findUnique({ where: { metaTemplateId: metaId } });
        if (byId) return byId;
      }
      if (name && language) return this.prisma.template.findUnique({ where: { name_language: { name, language } } });
      if (name) return this.prisma.template.findFirst({ where: { name } });
      return null;
    };
    let t = await find();
    if (!t) {
      // plantilla desconocida: resincroniza con Meta y vuelve a buscar
      try {
        await this.sync();
      } catch (e) {
        this.log.warn(`No se pudo resincronizar tras webhook de plantilla ${name ?? metaId}: ${(e as Error).message}`);
      }
      t = await find();
      if (!t) this.log.warn(`Webhook de plantilla desconocida (${name ?? metaId}) y no está en Meta`);
    }
    return t;
  }

  async handleStatusUpdate(value: any) {
    const t = await this.findForWebhook(value);
    if (!t) return;
    const event = String(value?.event ?? '').toUpperCase();
    const data: Prisma.TemplateUpdateInput = {};
    let newStatus: string = t.status;
    if (event === 'FLAGGED') {
      // aviso previo a la desactivación: el estado no cambia, pero hay que avisar
      newStatus = 'FLAGGED';
    } else {
      const mapped = mapMetaStatus(event);
      newStatus = mapped;
      data.status = mapped;
      data.rejectedReason = mapped === 'REJECTED' ? rejectionReasonEs(value?.reason) ?? 'Meta no ha indicado el motivo' : null;
    }
    if (value?.message_template_id != null && !t.metaTemplateId) data.metaTemplateId = String(value.message_template_id);
    const row = await this.prisma.template.update({ where: { id: t.id }, data: { ...data, lastSyncedAt: new Date() } });
    await this.notifyChange(row, t.status, { status: newStatus, force: event === 'FLAGGED' });
  }

  async handleQualityUpdate(value: any) {
    const t = await this.findForWebhook(value);
    if (!t) return;
    const score = String(value?.new_quality_score ?? 'UNKNOWN').toUpperCase();
    const row = await this.prisma.template.update({ where: { id: t.id }, data: { qualityScore: score, lastSyncedAt: new Date() } });
    this.realtime.emit('template.updated', { templateId: row.id, status: row.status });
  }

  async handleCategoryUpdate(value: any) {
    const t = await this.findForWebhook(value);
    if (!t) return;
    const category = mapMetaCategory(value?.new_category);
    const row = await this.prisma.template.update({ where: { id: t.id }, data: { category, lastSyncedAt: new Date() } });
    this.realtime.emit('template.updated', { templateId: row.id, status: row.status });
  }

  // ───────── errores de Meta ─────────

  private metaError(e: unknown, prefix: string) {
    if (e instanceof WhatsAppApiError) {
      const detail = e.graph?.error_data?.details || (e.graph as any)?.error_user_msg || e.info.es;
      return new BadGatewayException({ statusCode: 502, message: `${prefix}: ${detail}`, code: 'META_ERROR', metaCode: e.code });
    }
    return new BadGatewayException({ statusCode: 502, message: `${prefix}. Inténtalo de nuevo en unos minutos.`, code: 'META_ERROR' });
  }
}

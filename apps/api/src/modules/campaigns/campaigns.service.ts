import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SKIP_REASON_ES,
  computeCost,
  estimateCampaignCost,
  normalizePhone,
  templateVariableKeys,
  audienceSchema,
  type AudienceCountDto,
  type AudienceCountRequest,
  type CampaignComparisonRow,
  type CampaignDto,
  type CampaignLaunchResultDto,
  type CampaignReportDto,
  type CampaignRecipientsPage,
  type CampaignUpsertDto,
  type TemplateComponent,
  type VariableSource,
  zonedParts,
} from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MediaService } from '../media/media.service';
import { SettingsService } from '../settings/settings.service';
import { costableMessageWhere, QualityService } from '../quality/quality.service';
import { MessagingService } from '../whatsapp/messaging.service';
import { AudienceService } from './audience.service';
import { CampaignRunnerService, resolveParams } from './campaign-runner.service';
import { CampaignClock } from './campaigns.clock';
import { campaignInclude, recipientInclude, toCampaignDto, toRecipientDto } from './campaigns.mapper';

type Tab = 'all' | 'delivered' | 'read' | 'replied' | 'failed' | 'skipped';

function tabWhere(tab: Tab): Prisma.CampaignRecipientWhereInput {
  switch (tab) {
    case 'delivered': return { OR: [{ status: { in: ['DELIVERED', 'READ'] } }, { deliveredAt: { not: null } }, { readAt: { not: null } }] };
    case 'read': return { OR: [{ status: 'READ' }, { readAt: { not: null } }] };
    case 'replied': return { repliedAt: { not: null } };
    case 'failed': return { status: 'FAILED' };
    case 'skipped': return { status: 'SKIPPED' };
    default: return {};
  }
}

/** Texto seguro para CSV: sin fórmulas ejecutables y con comillas escapadas. */
function csvCell(v: unknown): string {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceService,
    private readonly runner: CampaignRunnerService,
    private readonly messaging: MessagingService,
    private readonly settings: SettingsService,
    private readonly quality: QualityService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly clock: CampaignClock,
  ) {}

  // ───────────────────────── Borradores ─────────────────────────

  async list(): Promise<CampaignDto[]> {
    const rows = await this.prisma.campaign.findMany({ include: campaignInclude, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => toCampaignDto(r));
  }

  private async load(id: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id }, include: campaignInclude });
    if (!c) throw new NotFoundException({ statusCode: 404, message: 'Campaña no encontrada' });
    return c;
  }

  /** La plantilla de un borrador debe ser de marketing aprobada con botón «No recibir más». */
  private async assertTemplateUsable(templateId: string) {
    const t = await this.prisma.template.findUnique({ where: { id: templateId } });
    if (!t) throw new BadRequestException({ statusCode: 400, message: 'La plantilla no existe' });
    if (t.status !== 'APPROVED') throw new BadRequestException({ statusCode: 400, message: 'La plantilla no está aprobada por Meta' });
    if (t.category !== 'MARKETING' || !t.hasOptOutButton) {
      throw new BadRequestException({ statusCode: 400, message: 'Solo se pueden usar plantillas de marketing con el botón «No recibir más»' });
    }
    return t;
  }

  async create(dto: CampaignUpsertDto, userId: string): Promise<CampaignDto> {
    await this.assertTemplateUsable(dto.templateId);
    const est = await this.estimate(dto);
    const c = await this.prisma.campaign.create({
      data: {
        name: dto.name,
        templateId: dto.templateId,
        variableMapping: dto.variableMapping as Prisma.InputJsonValue,
        headerMediaId: dto.headerMediaFileId ?? null,
        audience: dto.audience as Prisma.InputJsonValue,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        ratePerMinute: dto.ratePerMinute,
        createdById: userId,
        totalRecipients: est.willReceive,
        estimatedCost: est.estimatedCost,
      },
      include: campaignInclude,
    });
    return toCampaignDto(c);
  }

  async update(id: string, dto: CampaignUpsertDto): Promise<CampaignDto> {
    const cur = await this.load(id);
    if (cur.status !== 'DRAFT') throw new ConflictException({ statusCode: 409, message: 'Solo se pueden editar los borradores' });
    await this.assertTemplateUsable(dto.templateId);
    const est = await this.estimate(dto);
    // Solo si SIGUE siendo borrador: si otro lo lanzó mientras tanto, no se pisa (409)
    const upd = await this.prisma.campaign.updateMany({
      where: { id, status: 'DRAFT' },
      data: {
        name: dto.name,
        templateId: dto.templateId,
        variableMapping: dto.variableMapping as Prisma.InputJsonValue,
        headerMediaId: dto.headerMediaFileId ?? null,
        audience: dto.audience as Prisma.InputJsonValue,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        ratePerMinute: dto.ratePerMinute,
        totalRecipients: est.willReceive,
        estimatedCost: est.estimatedCost,
      },
    });
    if (!upd.count) throw new ConflictException({ statusCode: 409, message: 'Solo se pueden editar los borradores' });
    return toCampaignDto(await this.load(id));
  }

  async remove(id: string, userId: string, ip?: string | null): Promise<{ ok: true }> {
    const c = await this.load(id);
    if (c.status !== 'DRAFT') throw new ConflictException({ statusCode: 409, message: 'Solo se pueden borrar los borradores' });
    await this.prisma.campaign.delete({ where: { id } });
    await this.audit.log({ userId, action: 'delete_campaign', entityType: 'Campaign', entityId: id, data: { name: c.name }, ip });
    return { ok: true };
  }

  async duplicate(id: string, userId: string): Promise<CampaignDto> {
    const c = await this.load(id);
    const copy = await this.prisma.campaign.create({
      data: {
        name: `${c.name} (copia)`.slice(0, 120),
        templateId: c.templateId,
        variableMapping: (c.variableMapping ?? {}) as Prisma.InputJsonValue,
        headerMediaId: c.headerMediaId,
        audience: (c.audience ?? {}) as Prisma.InputJsonValue,
        ratePerMinute: c.ratePerMinute,
        createdById: userId,
        totalRecipients: c.status === 'DRAFT' ? c.totalRecipients : 0,
        estimatedCost: c.estimatedCost,
      },
      include: campaignInclude,
    });
    return toCampaignDto(copy);
  }

  private estimate(dto: { audience: CampaignUpsertDto['audience']; templateId?: string | null; ratePerMinute?: number }): Promise<AudienceCountDto> {
    return this.audience.count({ audience: dto.audience, templateId: dto.templateId, ratePerMinute: dto.ratePerMinute });
  }

  countAudience(req: AudienceCountRequest) {
    return this.audience.count(req);
  }

  // ───────────────────────── Lanzar y controlar ─────────────────────────

  async launch(id: string, userId: string, scheduledAtOverride?: string | null, ip?: string | null): Promise<CampaignLaunchResultDto> {
    const c = await this.load(id);
    if (c.status !== 'DRAFT') throw new ConflictException({ statusCode: 409, message: 'Solo se puede lanzar un borrador' });
    const t = await this.assertTemplateUsable(c.templateId);

    // Variables: todas mapeadas; cabecera multimedia si la plantilla la pide
    const comps = t.components as unknown as TemplateComponent[];
    const mapping = (c.variableMapping ?? {}) as Record<string, VariableSource>;
    const unmapped = templateVariableKeys(comps).filter((k) => !mapping[k]);
    if (unmapped.length) throw new BadRequestException({ statusCode: 400, message: `Falta indicar de dónde sale cada variable: ${unmapped.join(', ')}` });
    const header = comps.find((x) => x.type === 'HEADER');
    if (header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format ?? '')) {
      if (!c.headerMediaId) throw new BadRequestException({ statusCode: 400, message: 'La plantilla necesita un archivo para la cabecera' });
      await this.media.get(c.headerMediaId);
    }

    const aud = audienceSchema.parse(c.audience);
    const now = this.clock.now();
    const scheduledAt = scheduledAtOverride !== undefined ? (scheduledAtOverride ? new Date(scheduledAtOverride) : null) : c.scheduledAt;
    const future = !!scheduledAt && scheduledAt.getTime() > now.getTime() + 60_000;
    const count = await this.audience.count({ audience: aud, templateId: c.templateId, ratePerMinute: c.ratePerMinute, scheduledAt: future ? scheduledAt!.toISOString() : null });
    if (count.willReceive === 0) throw new BadRequestException({ statusCode: 400, message: 'La audiencia no tiene ningún destinatario que pueda recibir la campaña' });
    const rates = await this.settings.get('rates');
    const estimatedCost = estimateCampaignCost(count.willReceive, t.category as 'MARKETING', rates);

    if (future) {
      const sch = await this.prisma.campaign.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SCHEDULED', scheduledAt, totalRecipients: count.willReceive, estimatedCost } });
      if (!sch.count) throw new ConflictException({ statusCode: 409, message: 'La campaña ya se ha lanzado' });
      await this.audit.log({ userId, action: 'schedule_campaign', entityType: 'Campaign', entityId: id, data: { scheduledAt, willReceive: count.willReceive }, ip });
      return { campaign: toCampaignDto(await this.load(id)), plan: count.plan, scheduled: true };
    }
    // Lanzar ahora con el número en rojo/marcado/restringido o con los envíos detenidos no se permite (se puede programar para más tarde)
    const blocked = await this.quality.blockingReason();
    if (blocked) throw new ConflictException({ statusCode: 409, message: `No se puede lanzar ahora: ${blocked}. Revisa Calidad y la cuenta de WhatsApp.` });
    await this.prisma.campaign.update({ where: { id }, data: { scheduledAt: null, estimatedCost } });
    const started = await this.runner.start(id);
    if (!started) throw new ConflictException({ statusCode: 409, message: 'La campaña ya se ha lanzado' });
    await this.audit.log({ userId, action: 'launch_campaign', entityType: 'Campaign', entityId: id, data: { willReceive: count.willReceive, plan: count.plan }, ip });
    await this.runner.tick(id);
    return { campaign: toCampaignDto(await this.load(id)), plan: count.plan, scheduled: false };
  }

  async pause(id: string, userId: string, ip?: string | null) {
    await this.load(id);
    await this.runner.pause(id);
    await this.audit.log({ userId, action: 'pause_campaign', entityType: 'Campaign', entityId: id, ip });
    return this.get(id);
  }

  async resume(id: string, userId: string, ip?: string | null) {
    await this.load(id);
    await this.runner.resume(id);
    await this.audit.log({ userId, action: 'resume_campaign', entityType: 'Campaign', entityId: id, ip });
    await this.runner.tick(id);
    return this.get(id);
  }

  async cancel(id: string, userId: string, ip?: string | null) {
    await this.load(id);
    await this.runner.cancel(id);
    await this.audit.log({ userId, action: 'cancel_campaign', entityType: 'Campaign', entityId: id, ip });
    return this.get(id);
  }

  // ───────────────────────── Prueba (RF-5.4) ─────────────────────────

  /** Envía la plantilla a un número, sin contarlo en la campaña (no lleva campaignId). */
  async test(id: string, phone: string, userId: string, ip?: string | null) {
    const c = await this.load(id);
    const t = await this.assertTemplateUsable(c.templateId);
    const n = normalizePhone(phone);
    if (!n.ok) throw new BadRequestException({ statusCode: 400, message: `Teléfono no válido: ${n.reason}` });
    let contact = await this.prisma.contact.findUnique({ where: { phoneE164: n.e164 } });
    if (!contact) contact = await this.prisma.contact.create({ data: { phoneE164: n.e164, waId: n.waId } });
    else if (contact.deletedAt) throw new ConflictException({ statusCode: 409, message: 'Ese número pertenece a un contacto borrado' });
    const keys = templateVariableKeys(t.components as unknown as TemplateComponent[]);
    const { params, missing } = resolveParams(keys, (c.variableMapping ?? {}) as Record<string, VariableSource>, contact);
    if (missing.length) throw new BadRequestException({ statusCode: 400, message: `Ese contacto no tiene datos para ${missing.join(', ')} y no hay texto de respaldo` });
    const conv = await this.messaging.ensureConversationForContact(contact.id);
    const msg = await this.messaging.sendTemplate(conv.id, c.templateId, params, { headerMediaFileId: c.headerMediaId, userId });
    await this.audit.log({ userId, action: 'test_campaign', entityType: 'Campaign', entityId: id, data: { phone: n.e164 }, ip });
    return { ok: true, messageId: msg.id, conversationId: conv.id, status: msg.status };
  }

  // ───────────────────────── Informe (RF-5.7) ─────────────────────────

  async get(id: string): Promise<CampaignReportDto> {
    const c = await this.load(id);
    const [rates, failed, skipped, msgs, queued] = await Promise.all([
      this.settings.get('rates'),
      this.prisma.campaignRecipient.groupBy({ by: ['errorCode', 'errorTitle'], where: { campaignId: id, status: 'FAILED' }, _count: { _all: true } }),
      this.prisma.campaignRecipient.groupBy({ by: ['skipReason'], where: { campaignId: id, status: 'SKIPPED' }, _count: { _all: true } }),
      this.prisma.message.findMany({ where: { campaignId: id, ...costableMessageWhere() }, select: { pricingCategory: true, billable: true } }),
      this.prisma.campaignRecipient.findMany({ where: { campaignId: id, status: { in: ['QUEUED', 'SENDING'] } }, select: { plannedFor: true } }),
    ]);
    const cost = computeCost(msgs, rates);
    const billable = msgs.filter((m) => m.billable).length;
    const reasons = new Map<string, { code: number | null; title: string; count: number }>();
    for (const f of failed) {
      const title = f.errorTitle ?? 'Error al enviar el mensaje';
      const k = `${f.errorCode ?? ''}|${title}`;
      const cur = reasons.get(k) ?? { code: f.errorCode, title, count: 0 };
      cur.count += f._count._all;
      reasons.set(k, cur);
    }
    const days = new Map<string, number>();
    const now = this.clock.now();
    // Una cancelada no tiene nada pendiente ni plan: lo que no salió quedó SKIPPED «CANCELLED»
    const pendingRows = c.status === 'CANCELLED' ? [] : queued;
    for (const q of pendingRows) {
      const d = zonedParts(q.plannedFor && q.plannedFor > now ? q.plannedFor : now).ymd;
      days.set(d, (days.get(d) ?? 0) + 1);
    }
    return {
      campaign: toCampaignDto(c, { actualCost: cost.total }),
      funnel: { sent: c.sentCount, delivered: c.deliveredCount, read: c.readCount, replied: c.repliedCount },
      pending: pendingRows.length,
      failureReasons: [...reasons.values()].sort((a, b) => b.count - a.count),
      skipReasons: skipped.map((s) => ({ reason: s.skipReason ?? 'OTHER', title: SKIP_REASON_ES[s.skipReason ?? ''] ?? s.skipReason ?? 'Otro motivo', count: s._count._all })).sort((a, b) => b.count - a.count),
      cost: { estimated: c.estimatedCost != null ? Number(c.estimatedCost) : null, actual: cost.total, billableMessages: billable, byCategory: cost.byCategory, currency: c.currency },
      remainingPlan: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count })),
    };
  }

  private recipientsWhere(id: string, tab: Tab, q?: string): Prisma.CampaignRecipientWhereInput {
    const and: Prisma.CampaignRecipientWhereInput[] = [{ campaignId: id }, tabWhere(tab)];
    const term = q?.trim();
    if (term) {
      and.push({
        OR: [
          { phoneE164: { contains: term.replace(/\s+/g, ''), mode: 'insensitive' } },
          { contact: { OR: [
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { profileName: { contains: term, mode: 'insensitive' } },
            { company: { contains: term, mode: 'insensitive' } },
          ] } },
        ],
      });
    }
    return { AND: and };
  }

  async recipients(id: string, q: { tab: Tab; q?: string; page: number; pageSize: number }): Promise<CampaignRecipientsPage> {
    await this.load(id);
    const where = this.recipientsWhere(id, q.tab, q.q);
    const tabs: Tab[] = ['all', 'delivered', 'read', 'replied', 'failed', 'skipped'];
    const [items, total, ...counts] = await Promise.all([
      this.prisma.campaignRecipient.findMany({
        where,
        include: recipientInclude,
        orderBy: [{ sentAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.campaignRecipient.count({ where }),
      ...tabs.map((t) => this.prisma.campaignRecipient.count({ where: this.recipientsWhere(id, t, q.q) })),
    ]);
    return { items: items.map(toRecipientDto), total, page: q.page, pageSize: q.pageSize, tabCounts: Object.fromEntries(tabs.map((t, i) => [t, counts[i]])) as CampaignRecipientsPage['tabCounts'] };
  }

  /** CSV con «;» y BOM para que Excel lo abra bien en español. */
  async exportCsv(id: string, userId: string, ip?: string | null): Promise<{ name: string; csv: string }> {
    const c = await this.load(id);
    const rows = await this.prisma.campaignRecipient.findMany({ where: { campaignId: id }, include: recipientInclude, orderBy: [{ sentAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }] });
    const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' }).format(d) : '');
    const head = ['Nombre', 'Teléfono', 'Estado', 'Motivo de omisión', 'Error', 'Enviado', 'Entregado', 'Leído', 'Respondió', 'Se dio de baja'];
    const lines = [head.map(csvCell).join(';')];
    for (const r of rows) {
      const dto = toRecipientDto(r);
      lines.push([
        dto.displayName, dto.phoneE164, dto.status, r.skipReason ? (SKIP_REASON_ES[r.skipReason] ?? r.skipReason) : '', r.errorTitle ?? '',
        fmt(r.sentAt), fmt(r.deliveredAt), fmt(r.readAt), fmt(r.repliedAt), fmt(r.optedOutAt),
      ].map(csvCell).join(';'));
    }
    await this.audit.log({ userId, action: 'export_campaign', entityType: 'Campaign', entityId: id, data: { rows: rows.length }, ip });
    const safe = c.name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60) || 'campana';
    return { name: `campana_${safe}.csv`, csv: '﻿' + lines.join('\r\n') + '\r\n' };
  }

  // ───────────────────────── Analítica comparativa (RF-6.3) ─────────────────────────

  async analytics(): Promise<CampaignComparisonRow[]> {
    const rows = await this.prisma.campaign.findMany({ where: { startedAt: { not: null }, status: { not: 'DRAFT' } }, orderBy: { startedAt: 'desc' }, take: 100 });
    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
    return rows.map((c) => ({
      campaignId: c.id,
      name: c.name,
      sentAt: c.startedAt?.toISOString() ?? null,
      recipients: c.totalRecipients,
      deliveredPct: pct(c.deliveredCount, c.sentCount),
      readPct: pct(c.readCount, c.sentCount),
      repliedPct: pct(c.repliedCount, c.sentCount),
      optOutPct: pct(c.optOutCount, c.sentCount),
    }));
  }
}

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LABELS_ES, normalizePhone,
  type BulkContactsDto, type ConsentChangeDto, type ConsentEventDto, type ContactCampaignDto, type ContactDto, type ContactListQuery,
  type ContactUpsertDto, type Paginated,
} from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { contactInclude, toContactDto } from '../inbox/mappers';
import { ConsentService } from './consent.service';
import { searchCondition } from './contacts.search';
import { ContactFactory } from './contact-factory.service';
import { SuppressionService } from './suppression.service';

const BLANK = { firstName: null, lastName: null, email: null, company: null, customerCode: null, taxId: null, landline: null, notes: null };
type Ctx = { userId: string; ip?: string | null };

@Injectable()
export class ContactsService {
  private readonly log = new Logger('Contacts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly suppression: SuppressionService,
    private readonly factory: ContactFactory,
  ) {}

  // ── Listado ──

  async buildWhere(q: Partial<ContactListQuery>): Promise<Prisma.ContactWhereInput> {
    const and: Prisma.ContactWhereInput[] = [{ deletedAt: null }];
    if (q.q) {
      const cond = searchCondition(q.q);
      if (cond) {
        const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Contact" WHERE "deletedAt" IS NULL AND ${cond}`);
        and.push({ id: { in: rows.map((r) => r.id) } });
      }
    }
    if (q.includeLabelIds?.length) and.push({ labels: { some: { labelId: { in: q.includeLabelIds } } } });
    if (q.excludeLabelIds?.length) and.push({ NOT: { labels: { some: { labelId: { in: q.excludeLabelIds } } } } });
    if (q.ids?.length) and.push({ id: { in: q.ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)) } });
    if (q.consent) and.push({ consentStatus: q.consent });
    if (q.phoneInvalid !== undefined) and.push({ phoneInvalid: q.phoneInvalid });
    if (q.whatsapp) and.push({ phoneE164: q.whatsapp === 'with' ? { not: null } : null });
    return { AND: and };
  }

  private orderBy(sort: ContactListQuery['sort'] | undefined): Prisma.ContactOrderByWithRelationInput[] {
    if (sort === 'createdAt') return [{ createdAt: 'desc' }, { id: 'asc' }];
    if (sort === 'lastActivity') return [{ conversation: { lastMessageAt: { sort: 'desc', nulls: 'last' } } }, { id: 'asc' }];
    return [
      { firstName: { sort: 'asc', nulls: 'last' } },
      { lastName: { sort: 'asc', nulls: 'last' } },
      { company: { sort: 'asc', nulls: 'last' } },
      { phoneE164: 'asc' },
      { email: { sort: 'asc', nulls: 'last' } },
      { id: 'asc' },
    ];
  }

  async list(q: ContactListQuery): Promise<Paginated<ContactDto>> {
    const where = await this.buildWhere(q);
    const [rows, total] = await Promise.all([
      this.prisma.contact.findMany({ where, include: contactInclude, orderBy: this.orderBy(q.sort), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.contact.count({ where }),
    ]);
    return { items: rows.map(toContactDto), total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string): Promise<ContactDto> {
    const c = await this.prisma.contact.findFirst({ where: { id, deletedAt: null }, include: contactInclude });
    if (!c) throw new NotFoundException({ statusCode: 404, message: 'Contacto no encontrado' });
    return toContactDto(c);
  }

  // ── Alta y edición ──

  private async checkLabels(labelIds: string[] | undefined) {
    if (!labelIds?.length) return;
    const n = await this.prisma.label.count({ where: { id: { in: labelIds }, scope: 'CONTACT' } });
    if (n !== new Set(labelIds).size) throw new BadRequestException({ statusCode: 400, message: 'Alguna etiqueta no existe o no es de contacto' });
  }

  private phoneOrThrow(phone: string) {
    const n = normalizePhone(phone);
    if (!n.ok) {
      throw new BadRequestException({ statusCode: 400, code: 'PHONE_INVALID', message: n.code === 'INCOMPLETE_ES' ? `Teléfono español incompleto: ${phone}` : `Teléfono no válido: ${phone}` });
    }
    return n;
  }

  /** Un contacto necesita teléfono (WhatsApp) o correo; sin teléfono es un contacto «Sin WhatsApp» (P16). */
  private identityOrThrow(phone: string | null | undefined, email: string | null | undefined, customerCode?: string | null) {
    if (!phone && !email && !customerCode) {
      throw new BadRequestException({ statusCode: 400, code: 'NO_IDENTITY', message: 'Indica un teléfono o un correo: un contacto necesita al menos uno de los dos' });
    }
  }

  private async emailTaken(email: string, exceptId?: string) {
    return this.prisma.contact.findFirst({
      where: { id: exceptId ? { not: exceptId } : undefined, email: { equals: email, mode: 'insensitive' }, phoneE164: null },
      select: { id: true, deletedAt: true },
    });
  }

  async create(dto: ContactUpsertDto, ctx: Ctx): Promise<ContactDto> {
    const { phone: rawPhone, labelIds, ...fields } = dto;
    const phone = rawPhone?.trim() || null;
    this.identityOrThrow(phone, fields.email);
    await this.checkLabels(labelIds);
    if (!phone) return this.createWithoutPhone(fields, labelIds);
    const n = this.phoneOrThrow(phone);
    const existing = await this.prisma.contact.findUnique({ where: { phoneE164: n.e164 } });
    if (existing && !existing.deletedAt) {
      throw new ConflictException({ statusCode: 409, code: 'PHONE_EXISTS', message: 'Ya existe un contacto con ese teléfono', details: { contactId: existing.id } });
    }
    const id = await this.prisma.$transaction(async (tx) => {
      let cid: string;
      if (existing) {
        // contacto borrado antes: se reactiva con los datos nuevos (conserva su consentimiento, p. ej. una baja)
        await tx.contactLabel.deleteMany({ where: { contactId: existing.id } });
        await tx.contact.update({
          where: { id: existing.id },
          data: { ...BLANK, ...fields, deletedAt: null },
        });
        cid = existing.id;
      } else {
        const c = await this.factory.create({ ...fields, phoneE164: n.e164, waId: n.waId }, { db: tx, userId: ctx.userId });
        cid = c.id;
      }
      if (labelIds?.length) await tx.contactLabel.createMany({ data: [...new Set(labelIds)].map((labelId) => ({ contactId: cid, labelId })), skipDuplicates: true });
      return cid;
    });
    return this.get(id);
  }

  /** Alta de un contacto sin teléfono (solo correo): duplicado por correo sin distinguir mayúsculas. */
  private async createWithoutPhone(fields: Omit<ContactUpsertDto, 'phone' | 'labelIds'>, labelIds: string[] | undefined): Promise<ContactDto> {
    const email = fields.email!.toLowerCase();
    const other = await this.emailTaken(email);
    if (other && !other.deletedAt) {
      throw new ConflictException({ statusCode: 409, code: 'EMAIL_EXISTS', message: 'Ya existe un contacto sin teléfono con ese correo', details: { contactId: other.id } });
    }
    const id = await this.prisma.$transaction(async (tx) => {
      let cid: string;
      if (other) {
        await tx.contactLabel.deleteMany({ where: { contactId: other.id } });
        await tx.contact.update({ where: { id: other.id }, data: { ...BLANK, ...fields, email, deletedAt: null } });
        cid = other.id;
      } else cid = (await tx.contact.create({ data: { ...fields, email } })).id;
      if (labelIds?.length) await tx.contactLabel.createMany({ data: [...new Set(labelIds)].map((labelId) => ({ contactId: cid, labelId })), skipDuplicates: true });
      return cid;
    });
    return this.get(id);
  }

  async update(id: string, dto: Partial<ContactUpsertDto>, ctx: Ctx): Promise<ContactDto> {
    const cur = await this.prisma.contact.findFirst({ where: { id, deletedAt: null } });
    if (!cur) throw new NotFoundException({ statusCode: 404, message: 'Contacto no encontrado' });
    const { phone, labelIds, ...fields } = dto;
    await this.checkLabels(labelIds);
    const data: Prisma.ContactUpdateInput = { ...fields };
    const newPhone = phone === undefined ? undefined : phone?.trim() || null;
    const finalPhone = newPhone === undefined ? cur.phoneE164 : newPhone;
    const finalEmail = fields.email === undefined ? cur.email : fields.email;
    this.identityOrThrow(finalPhone, finalEmail, fields.customerCode === undefined ? cur.customerCode : fields.customerCode);
    if (newPhone === null && cur.phoneE164) {
      if (!finalEmail) throw new BadRequestException({ statusCode: 400, code: 'NO_IDENTITY', message: 'Para quitar el teléfono el contacto necesita un correo' });
      if (await this.prisma.conversation.count({ where: { contactId: id } })) {
        throw new BadRequestException({ statusCode: 400, code: 'HAS_CONVERSATION', message: 'Este contacto tiene una conversación de WhatsApp: no se le puede quitar el teléfono' });
      }
      data.phoneE164 = null;
      data.waId = null;
    }
    if (newPhone) {
      const n = this.phoneOrThrow(newPhone);
      if (n.e164 !== cur.phoneE164) {
        const other = await this.prisma.contact.findUnique({ where: { phoneE164: n.e164 } });
        if (other) {
          throw new ConflictException({ statusCode: 409, code: 'PHONE_EXISTS', message: other.deletedAt ? 'Ese teléfono pertenece a un contacto borrado' : 'Ya existe un contacto con ese teléfono', details: { contactId: other.id } });
        }
        data.phoneE164 = n.e164;
        data.waId = n.waId;
        data.phoneInvalid = false;
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.contact.update({ where: { id }, data });
      if (labelIds) {
        await tx.contactLabel.deleteMany({ where: { contactId: id, labelId: { notIn: labelIds } } });
        if (labelIds.length) await tx.contactLabel.createMany({ data: [...new Set(labelIds)].map((labelId) => ({ contactId: id, labelId })), skipDuplicates: true });
      }
    });
    return this.get(id);
  }

  // ── Borrado ──

  async remove(id: string, hard: boolean, ctx: Ctx) {
    const c = await this.prisma.contact.findUnique({ where: { id } });
    if (!c || (c.deletedAt && !hard)) throw new NotFoundException({ statusCode: 404, message: 'Contacto no encontrado' });
    if (hard) {
      // Supresión física (derecho de supresión, regla 7): conversación, mensajes, envíos de campaña, adjuntos (y sus objetos
      // de Storage salvo los de la biblioteca u otros mensajes) y eventos de webhook con su número. Queda su hash en la
      // lista de supresión (si el número vuelve, nace REVOKED) y el rastro en AuditLog sin datos personales.
      const conv = await this.prisma.conversation.findUnique({ where: { contactId: id }, select: { id: true } });
      const mediaIds = conv
        ? (await this.prisma.message.findMany({ where: { conversationId: conv.id, mediaId: { not: null } }, select: { mediaId: true }, distinct: ['mediaId'] })).map((m) => m.mediaId!)
        : [];
      const digits = [...new Set([c.waId, c.phoneE164?.replace(/\D/g, '')].filter((x): x is string => !!x && /^\d{6,20}$/.test(x)))];
      let storagePaths: string[] = [];
      let webhookEvents = 0;
      await this.prisma.$transaction(async (tx) => {
        await tx.campaignRecipient.deleteMany({ where: { contactId: id } });
        await tx.contact.delete({ where: { id } });
        if (c.phoneE164) {
          await this.suppression.add(c.phoneE164, tx);
          // el número no puede quedar en claro en el registro de auditoría (p. ej. `test_campaign` de versiones anteriores):
          // se sustituye por sus últimos 4 dígitos
          await tx.$executeRaw`UPDATE "AuditLog" SET "data" = ("data" - 'phone') || jsonb_build_object('phoneLast4', right("data"->>'phone', 4)) WHERE "data"->>'phone' IN (${c.phoneE164}, ${c.waId ?? c.phoneE164})`;
        }
        if (mediaIds.length) {
          const [msgs, lib, imports] = await Promise.all([
            tx.message.findMany({ where: { mediaId: { in: mediaIds } }, select: { mediaId: true }, distinct: ['mediaId'] }),
            tx.libraryFile.findMany({ where: { mediaFileId: { in: mediaIds } }, select: { mediaFileId: true } }),
            tx.importJob.findMany({ where: { mediaFileId: { in: mediaIds } }, select: { mediaFileId: true } }),
          ]);
          const used = new Set<string>([...msgs.map((m) => m.mediaId!), ...lib.map((l) => l.mediaFileId), ...imports.map((j) => j.mediaFileId)]);
          const orphans = mediaIds.filter((m) => !used.has(m));
          if (orphans.length) {
            storagePaths = (await tx.mediaFile.findMany({ where: { id: { in: orphans } }, select: { storagePath: true } })).map((m) => m.storagePath);
            await tx.mediaFile.deleteMany({ where: { id: { in: orphans } } });
          }
        }
        if (digits.length) {
          // eventos de webhook ya tratados (o fallidos) que mencionan el número como wa_id / recipient_id; los pendientes se respetan
          const re = `(^|[^0-9])(${digits.join('|')})([^0-9]|$)`;
          webhookEvents = await tx.$executeRaw`DELETE FROM "WebhookEvent" WHERE ("processedAt" IS NOT NULL OR "error" IS NOT NULL) AND "payload"::text ~ ${re}`;
        }
      });
      if (storagePaths.length) {
        await this.storage.remove(storagePaths).catch((e) => this.log.warn(`No se pudieron borrar ${storagePaths.length} objetos de Storage de un contacto suprimido: ${(e as Error).message}`));
      }
      await this.audit.log({
        userId: ctx.userId, action: 'hard_delete_contact', entityType: 'Contact', entityId: id,
        data: { phoneLast4: c.phoneE164?.slice(-4) ?? null, mediaDeleted: storagePaths.length, webhookEventsDeleted: webhookEvents }, ip: ctx.ip,
      });
      return { ok: true, hard: true };
    }
    await this.prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: ctx.userId, action: 'delete_contact', entityType: 'Contact', entityId: id, data: { phoneLast4: c.phoneE164?.slice(-4) ?? null }, ip: ctx.ip });
    return { ok: true, hard: false };
  }

  // ── Consentimiento ──

  async consentHistory(id: string): Promise<ConsentEventDto[]> {
    await this.get(id);
    const events = await this.prisma.consentEvent.findMany({ where: { contactId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
    const userIds = [...new Set(events.map((e) => e.userId).filter((x): x is string => !!x))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return events.map((e) => ({ id: e.id, status: e.status, source: e.source, note: e.note, userName: e.userId ? names.get(e.userId) ?? null : null, createdAt: e.createdAt.toISOString() }));
  }

  async changeConsent(id: string, dto: ConsentChangeDto, ctx: Ctx): Promise<ContactDto> {
    const before = await this.get(id);
    const r = await this.consent.setConsent(id, dto.status, dto.source, { userId: ctx.userId, note: dto.note ?? null });
    if (r.changed) {
      await this.audit.log({ userId: ctx.userId, action: 'consent_change', entityType: 'Contact', entityId: id, data: { from: before.consentStatus, to: dto.status, source: dto.source, note: dto.note ?? null }, ip: ctx.ip });
    }
    return this.get(id);
  }

  // ── Acciones en bloque ──

  async bulk(dto: BulkContactsDto, ctx: Ctx): Promise<{ affected: number; unchanged: number }> {
    const ids = [...new Set(dto.contactIds)];
    const contacts = await this.prisma.contact.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, consentStatus: true } });
    if (dto.action === 'addLabel' || dto.action === 'removeLabel') {
      if (!dto.labelId) throw new BadRequestException({ statusCode: 400, message: 'Falta la etiqueta' });
      const label = await this.prisma.label.findFirst({ where: { id: dto.labelId, scope: 'CONTACT' } });
      if (!label) throw new BadRequestException({ statusCode: 400, message: 'La etiqueta no existe o no es de contacto' });
      if (dto.action === 'addLabel') {
        const r = await this.prisma.contactLabel.createMany({ data: contacts.map((c) => ({ contactId: c.id, labelId: label.id })), skipDuplicates: true });
        return { affected: r.count, unchanged: contacts.length - r.count };
      }
      const r = await this.prisma.contactLabel.deleteMany({ where: { labelId: label.id, contactId: { in: contacts.map((c) => c.id) } } });
      return { affected: r.count, unchanged: contacts.length - r.count };
    }
    if (!dto.consent) throw new BadRequestException({ statusCode: 400, message: 'Falta el consentimiento' });
    const c = dto.consent;
    let affected = 0;
    for (const x of contacts) {
      if (x.consentStatus === c.status) continue;
      const r = await this.consent.setConsent(x.id, c.status, c.source, { userId: ctx.userId, note: c.note ?? null });
      if (r.changed) affected++;
    }
    await this.audit.log({ userId: ctx.userId, action: 'consent_change', entityType: 'Contact', data: { bulk: true, count: affected, to: c.status, source: c.source, note: c.note ?? null }, ip: ctx.ip });
    return { affected, unchanged: contacts.length - affected };
  }

  // ── Campañas recibidas ──

  async campaigns(id: string): Promise<ContactCampaignDto[]> {
    await this.get(id);
    const rows = await this.prisma.campaignRecipient.findMany({
      where: { contactId: id },
      include: { campaign: { select: { id: true, name: true, createdAt: true } } },
      orderBy: { campaign: { createdAt: 'desc' } },
      take: 50,
    });
    return rows.map((r) => ({
      campaignId: r.campaignId, name: r.campaign.name, status: r.status, skipReason: r.skipReason,
      sentAt: r.sentAt?.toISOString() ?? null, deliveredAt: r.deliveredAt?.toISOString() ?? null, readAt: r.readAt?.toISOString() ?? null, repliedAt: r.repliedAt?.toISOString() ?? null,
    }));
  }

  // ── Exportación ──

  async exportCsv(q: Partial<ContactListQuery>, ctx: Ctx): Promise<{ csv: string; count: number }> {
    const where = await this.buildWhere(q);
    const rows = await this.prisma.contact.findMany({ where, include: contactInclude, orderBy: this.orderBy('name') });
    const head = ['Nombre', 'Apellidos', 'Teléfono', 'Correo', 'Empresa', 'Código', 'DNI/CIF', 'Teléfono fijo', 'Etiquetas', 'Consentimiento', 'Fecha consentimiento', 'Notas', 'Creado'];
    const lines = [head.map(csvCell).join(';')];
    for (const c of rows) {
      const d = toContactDto(c);
      lines.push(
        [d.firstName, d.lastName, d.phoneE164 ?? '', d.email, d.company, d.customerCode, d.taxId, d.landline, d.labels.map((l) => l.name).join(', '), LABELS_ES.consent[d.consentStatus], d.consentAt?.slice(0, 10), d.notes, d.createdAt.slice(0, 10)]
          .map(csvCell).join(';'),
      );
    }
    await this.audit.log({ userId: ctx.userId, action: 'export_contacts', entityType: 'Contact', data: { count: rows.length, filtered: !!(q.q || q.includeLabelIds?.length || q.excludeLabelIds?.length || q.consent || q.whatsapp || q.phoneInvalid !== undefined) }, ip: ctx.ip });
    return { csv: '﻿' + lines.join('\r\n') + '\r\n', count: rows.length };
  }
}

/** Celda CSV con comillas cuando hace falta; neutraliza fórmulas de Excel (=, @, +/- que no sean teléfono). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s))) s = "'" + s;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LABELS_ES, normalizePhone,
  type BulkContactsDto, type ConsentChangeDto, type ConsentEventDto, type ContactCampaignDto, type ContactDto, type ContactListQuery,
  type ContactUpsertDto, type Paginated,
} from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { contactInclude, toContactDto } from '../inbox/mappers';
import { ConsentService } from './consent.service';
import { searchCondition } from './contacts.search';

const BLANK = { firstName: null, lastName: null, email: null, company: null, customerCode: null, taxId: null, landline: null, notes: null };
type Ctx = { userId: string; ip?: string | null };

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService, private readonly consent: ConsentService, private readonly audit: AuditService) {}

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
    if (q.consent) and.push({ consentStatus: q.consent });
    if (q.phoneInvalid !== undefined) and.push({ phoneInvalid: q.phoneInvalid });
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
    if (!n.ok) throw new BadRequestException({ statusCode: 400, code: 'PHONE_INVALID', message: `Teléfono no válido: ${phone}` });
    return n;
  }

  async create(dto: ContactUpsertDto, ctx: Ctx): Promise<ContactDto> {
    const n = this.phoneOrThrow(dto.phone);
    const { phone: _p, labelIds, ...fields } = dto;
    await this.checkLabels(labelIds);
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
        const c = await tx.contact.create({ data: { ...fields, phoneE164: n.e164, waId: n.waId } });
        cid = c.id;
      }
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
    if (phone !== undefined) {
      const n = this.phoneOrThrow(phone);
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
      // Supresión física (derecho de supresión, regla 7): conversación, mensajes y envíos de campaña. El rastro queda en AuditLog sin datos personales.
      await this.prisma.$transaction(async (tx) => {
        await tx.campaignRecipient.deleteMany({ where: { contactId: id } });
        await tx.contact.delete({ where: { id } });
      });
      await this.audit.log({ userId: ctx.userId, action: 'hard_delete_contact', entityType: 'Contact', entityId: id, data: { phoneLast4: c.phoneE164.slice(-4) }, ip: ctx.ip });
      return { ok: true, hard: true };
    }
    await this.prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: ctx.userId, action: 'delete_contact', entityType: 'Contact', entityId: id, data: { phoneLast4: c.phoneE164.slice(-4) }, ip: ctx.ip });
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
        [d.firstName, d.lastName, d.phoneE164, d.email, d.company, d.customerCode, d.taxId, d.landline, d.labels.map((l) => l.name).join(', '), LABELS_ES.consent[d.consentStatus], d.consentAt?.slice(0, 10), d.notes, d.createdAt.slice(0, 10)]
          .map(csvCell).join(';'),
      );
    }
    await this.audit.log({ userId: ctx.userId, action: 'export_contacts', entityType: 'Contact', data: { count: rows.length, filtered: !!(q.q || q.includeLabelIds?.length || q.excludeLabelIds?.length || q.consent || q.phoneInvalid !== undefined) }, ip: ctx.ip });
    return { csv: '﻿' + lines.join('\r\n') + '\r\n', count: rows.length };
  }
}

/** Celda CSV con comillas cuando hace falta; neutraliza fórmulas de Excel (=, @, +/- que no sean teléfono). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s))) s = "'" + s;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

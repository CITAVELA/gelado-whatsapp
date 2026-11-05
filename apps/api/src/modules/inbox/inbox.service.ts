import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  normalizePhone,
  type ConversationDetailDto,
  type ConversationListItemDto,
  type ConversationListQuery,
  type CursorPage,
  type MessageDto,
  type TimelineItemDto,
} from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { MediaService } from '../media/media.service';
import { StorageService } from '../storage/storage.service';
import { MessagingService } from '../whatsapp/messaging.service';
import {
  contactInclude,
  conversationInclude,
  isWindowOpen,
  messageInclude,
  toContactDto,
  toConversationListItem,
  toEventDto,
  toMessageDto,
  type ConversationRow,
  type MessageRow,
} from './mappers';
import { ContactFactory } from '../contacts/contact-factory.service';

const ACCENTS_FROM = 'áàäâãéèëêíìïîóòöôõúùüûñç';
const ACCENTS_TO = 'aaaaaeeeeiiiiooooouuuunc';
/** minúsculas y sin tildes, en SQL (sin depender de la extensión unaccent) */
const norm = (col: Prisma.Sql) => Prisma.sql`translate(lower(${col}), ${ACCENTS_FROM}, ${ACCENTS_TO})`;
export const stripAccents = (s: string) => s.toLowerCase().replace(/./g, (ch) => { const i = ACCENTS_FROM.indexOf(ch); return i >= 0 ? ACCENTS_TO[i]! : ch; });

const encodeCursor = (parts: unknown[]) => Buffer.from(JSON.stringify(parts)).toString('base64url');
function decodeCursor(c: string | null | undefined): any[] | null {
  if (!c) return null;
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    return Array.isArray(v) ? v : null;
  } catch {
    throw new BadRequestException({ statusCode: 400, message: 'Cursor no válido' });
  }
}

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly storage: StorageService,
    private readonly messaging: MessagingService,
    private readonly contactFactory: ContactFactory,
  ) {}

  // ───────────────────────── Lista ─────────────────────────

  async list(q: ConversationListQuery, userId: string): Promise<CursorPage<ConversationListItemDto>> {
    const snoozed = q.status === 'SNOOZED';
    const key = snoozed ? Prisma.sql`COALESCE(c."snoozedUntil", c."createdAt")` : Prisma.sql`COALESCE(c."lastMessageAt", c."createdAt")`;
    const where: Prisma.Sql[] = [Prisma.sql`c.status = ${q.status}::"ConversationStatus"`, Prisma.sql`ct."deletedAt" IS NULL`];

    if (q.view === 'mine') where.push(Prisma.sql`c."assigneeId" = ${userId}::uuid`);
    if (q.view === 'unassigned') where.push(Prisma.sql`c."assigneeId" IS NULL`);
    if (q.view === 'unread') where.push(Prisma.sql`c."unreadCount" > 0`);
    if (q.view === 'starred') where.push(Prisma.sql`c.starred`);
    if (q.assigneeId) where.push(Prisma.sql`c."assigneeId" = ${q.assigneeId}::uuid`);
    if (q.labelId) {
      where.push(Prisma.sql`(EXISTS (SELECT 1 FROM "ContactLabel" x WHERE x."contactId" = ct.id AND x."labelId" = ${q.labelId}::uuid)
        OR EXISTS (SELECT 1 FROM "ConversationLabel" x WHERE x."conversationId" = c.id AND x."labelId" = ${q.labelId}::uuid))`);
    }
    if (q.conversationLabelId) where.push(Prisma.sql`EXISTS (SELECT 1 FROM "ConversationLabel" x WHERE x."conversationId" = c.id AND x."labelId" = ${q.conversationLabelId}::uuid)`);

    const search = q.q?.trim();
    if (search) where.push(this.searchClause(search));

    const cur = decodeCursor(q.cursor);
    if (cur) {
      const [t, id] = cur as [string, string];
      where.push(snoozed ? Prisma.sql`(${key}, c.id) > (${new Date(t)}::timestamptz, ${id}::uuid)` : Prisma.sql`(${key}, c.id) < (${new Date(t)}::timestamptz, ${id}::uuid)`);
    }
    const order = snoozed ? Prisma.sql`${key} ASC, c.id ASC` : Prisma.sql`${key} DESC, c.id DESC`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; k: Date }>>`
      SELECT c.id, ${key} AS k FROM "Conversation" c JOIN "Contact" ct ON ct.id = c."contactId"
      WHERE ${Prisma.join(where, ' AND ')} ORDER BY ${order} LIMIT ${q.limit + 1}`;

    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const ids = page.map((r) => r.id);
    const [convs, snippets] = await Promise.all([
      this.prisma.conversation.findMany({ where: { id: { in: ids } }, include: conversationInclude }),
      search ? this.snippets(ids, search) : Promise.resolve(new Map<string, string>()),
    ]);
    const names = await this.campaignNames(convs);
    const byId = new Map(convs.map((c) => [c.id, c]));
    const items = ids.flatMap((id) => {
      const c = byId.get(id);
      return c ? [toConversationListItem(c, { lastCampaignName: c.lastCampaignId ? names.get(c.lastCampaignId) ?? null : null, searchSnippet: snippets.get(id) ?? null })] : [];
    });
    const last = page.at(-1);
    return { items, nextCursor: hasMore && last ? encodeCursor([last.k.toISOString(), last.id]) : null };
  }

  private searchClause(search: string): Prisma.Sql {
    const s = stripAccents(search);
    const like = `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    const digits = search.replace(/\D/g, '');
    const parts: Prisma.Sql[] = [
      Prisma.sql`${norm(Prisma.sql`COALESCE(ct."firstName",'') || ' ' || COALESCE(ct."lastName",'')`)} LIKE ${like}`,
      Prisma.sql`${norm(Prisma.sql`COALESCE(ct."profileName",'')`)} LIKE ${like}`,
      Prisma.sql`${norm(Prisma.sql`COALESCE(ct."company",'')`)} LIKE ${like}`,
      Prisma.sql`lower(COALESCE(ct."customerCode",'')) LIKE ${like}`,
      Prisma.sql`ct."phoneE164" LIKE ${like}`,
      Prisma.sql`EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND to_tsvector('spanish', coalesce(m.body,'')) @@ websearch_to_tsquery('spanish', ${search}))`,
    ];
    if (digits.length >= 3) parts.push(Prisma.sql`ct."phoneE164" LIKE ${'%' + digits + '%'}`);
    return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
  }

  /** Fragmento del último mensaje que casa con la búsqueda (solo si casa por texto). */
  private async snippets(ids: string[], search: string): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ cid: string; snip: string }>>`
      SELECT DISTINCT ON (m."conversationId") m."conversationId" AS cid,
             ts_headline('spanish', m.body, websearch_to_tsquery('spanish', ${search}), 'MaxWords=18, MinWords=6') AS snip
      FROM "Message" m
      WHERE m."conversationId" = ANY(${ids}::uuid[]) AND to_tsvector('spanish', coalesce(m.body,'')) @@ websearch_to_tsquery('spanish', ${search})
      ORDER BY m."conversationId", m."createdAt" DESC`;
    return new Map(rows.map((r) => [r.cid, r.snip.replace(/<\/?b>/g, '')]));
  }

  private async campaignNames(convs: Array<{ lastCampaignId: string | null }>): Promise<Map<string, string>> {
    const ids = [...new Set(convs.map((c) => c.lastCampaignId).filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const cs = await this.prisma.campaign.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(cs.map((c) => [c.id, c.name]));
  }

  // ───────────────────────── Detalle ─────────────────────────

  async detail(id: string): Promise<ConversationDetailDto> {
    const c = await this.prisma.conversation.findUnique({
      where: { id },
      include: { ...conversationInclude, contact: { include: contactInclude } },
    });
    if (!c || c.contact.deletedAt) throw new NotFoundException({ statusCode: 404, message: 'Conversación no encontrada' });
    const names = await this.campaignNames([c]);
    const item = toConversationListItem(c as unknown as ConversationRow, { lastCampaignName: c.lastCampaignId ? names.get(c.lastCampaignId) ?? null : null });
    return {
      ...item,
      lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
      windowOpen: isWindowOpen(c.windowExpiresAt),
      contact: toContactDto(c.contact),
    };
  }

  /** Nueva conversación (RF-3.8): crea el contacto si no existe. Un teléfono = un contacto = una conversación. */
  async create(dto: { phone?: string; contactId?: string; firstName?: string }): Promise<ConversationDetailDto> {
    if (dto.contactId && !dto.phone) {
      // Por contacto: sin teléfono (P16) ensureConversationForContact lo rechaza con «Sin WhatsApp»
      const c = await this.prisma.contact.findFirst({ where: { id: dto.contactId, deletedAt: null }, select: { id: true } });
      if (!c) throw new NotFoundException({ statusCode: 404, message: 'Contacto no encontrado' });
      return this.detail((await this.messaging.ensureConversationForContact(c.id)).id);
    }
    const n = normalizePhone(dto.phone!);
    if (!n.ok) throw new BadRequestException({ statusCode: 400, message: n.reason });
    let contact = await this.prisma.contact.findFirst({ where: { OR: [{ phoneE164: n.e164 }, { waId: n.waId }] } });
    if (!contact) {
      try {
        contact = await this.contactFactory.create({ phoneE164: n.e164, waId: n.waId, firstName: dto.firstName?.trim() || null }); // un suprimido vuelve REVOKED
      } catch (e) {
        // Doble clic / petición concurrente con el mismo teléfono nuevo: ganó la otra, se relee su contacto (F-1).
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        contact = await this.prisma.contact.findFirstOrThrow({ where: { OR: [{ phoneE164: n.e164 }, { waId: n.waId }] } });
      }
    } else if (contact.deletedAt) {
      contact = await this.prisma.contact.update({ where: { id: contact.id }, data: { deletedAt: null } });
    }
    const conv = await this.messaging.ensureConversationForContact(contact.id);
    return this.detail(conv.id);
  }

  // ───────────────────────── Historial ─────────────────────────

  async timeline(conversationId: string, p: { cursor?: string | null; limit?: number }): Promise<CursorPage<TimelineItemDto>> {
    const exists = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true } });
    if (!exists) throw new NotFoundException({ statusCode: 404, message: 'Conversación no encontrada' });
    const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
    const cur = decodeCursor(p.cursor) as [string, string] | null;
    const before = cur ? { OR: [{ createdAt: { lt: new Date(cur[0]) } }, { createdAt: new Date(cur[0]), id: { lt: cur[1] } }] } : {};

    const [msgs, evs] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId, kind: { not: 'REACTION' }, ...before },
        include: messageInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      this.prisma.conversationEvent.findMany({
        where: { conversationId, ...before },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    ]);
    type Entry = { at: Date; id: string; m?: MessageRow; e?: (typeof evs)[number] };
    const merged: Entry[] = [...msgs.map((m) => ({ at: m.createdAt, id: m.id, m })), ...evs.map((e) => ({ at: e.createdAt, id: e.id, e }))].sort(
      (a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
    const hasMore = merged.length > limit;
    const page = merged.slice(0, limit);

    const pageMsgs = page.flatMap((x) => (x.m ? [x.m] : []));
    const { quotedByWamid, reactionsByWamid } = await this.context(conversationId, pageMsgs);
    // Firma de adjuntos en lote (una petición a Storage por página en vez de una por adjunto)
    await this.storage.primeSignedUrls([...pageMsgs, ...quotedByWamid.values()].flatMap((m) => (m.media ? [m.media.storagePath] : [])));
    const items: TimelineItemDto[] = [];
    for (const x of page) {
      if (x.m) {
        const message = await toMessageDto(x.m, this.media.signedUrl, {
          quoted: x.m.contextWamid ? quotedByWamid.get(x.m.contextWamid) ?? null : null,
          reactions: x.m.wamid ? reactionsByWamid.get(x.m.wamid) ?? [] : [],
        });
        items.push({ type: 'message', at: message.createdAt, message });
      } else if (x.e) {
        items.push({ type: 'event', at: x.e.createdAt.toISOString(), event: toEventDto(x.e) });
      }
    }
    const oldest = page.at(-1);
    return { items: items.reverse(), nextCursor: hasMore && oldest ? encodeCursor([oldest.at.toISOString(), oldest.id]) : null };
  }

  /** Mensajes citados y reacciones agregadas de una página de mensajes. */
  private async context(conversationId: string, msgs: MessageRow[]) {
    const quotedWamids = [...new Set(msgs.map((m) => m.contextWamid).filter((x): x is string => !!x))];
    const wamids = msgs.map((m) => m.wamid).filter((x): x is string => !!x);
    const [quoted, reacts] = await Promise.all([
      quotedWamids.length ? this.prisma.message.findMany({ where: { wamid: { in: quotedWamids } }, include: messageInclude }) : Promise.resolve([] as MessageRow[]),
      wamids.length
        ? this.prisma.$queryRaw<Array<{ target: string; emoji: string; direction: any; at: Date }>>`
            SELECT r.payload->>'message_id' AS target, COALESCE(r.payload->>'emoji', r.body, '') AS emoji, r.direction, r."createdAt" AS at
            FROM "Message" r WHERE r."conversationId" = ${conversationId}::uuid AND r.kind = 'REACTION' AND r.payload->>'message_id' = ANY(${wamids}::text[])
            ORDER BY r."createdAt" ASC`
        : Promise.resolve([]),
    ]);
    const quotedByWamid = new Map(quoted.map((q) => [q.wamid!, q]));
    // Última reacción de cada sentido sobre cada mensaje; un emoji vacío la quita
    const last = new Map<string, { emoji: string; direction: any; at: Date }>();
    for (const r of reacts) last.set(`${r.target}|${r.direction}`, { emoji: r.emoji, direction: r.direction, at: r.at });
    const reactionsByWamid = new Map<string, Array<{ emoji: string; direction: any; at: Date }>>();
    for (const [k, v] of last) {
      if (!v.emoji) continue;
      const target = k.split('|')[0]!;
      reactionsByWamid.set(target, [...(reactionsByWamid.get(target) ?? []), v]);
    }
    return { quotedByWamid, reactionsByWamid };
  }

  async messageDto(id: string): Promise<MessageDto> {
    const m = await this.prisma.message.findUniqueOrThrow({ where: { id }, include: messageInclude });
    const quoted = m.contextWamid ? await this.prisma.message.findUnique({ where: { wamid: m.contextWamid }, include: messageInclude }) : null;
    return toMessageDto(m, this.media.signedUrl, { quoted });
  }
}

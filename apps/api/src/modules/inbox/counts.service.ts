import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { InboxCountsDto } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { DomainEvents } from '../events/domain-events.service';
import { RealtimeService } from '../realtime/realtime.gateway';

const DEBOUNCE_MS = 300;

/** Contadores de la bandeja (3 consultas agregadas) y emisión de `badge.counts` con antirrebote. */
@Injectable()
export class CountsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('InboxCounts');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService, private readonly realtime: RealtimeService, private readonly events: DomainEvents) {}

  onModuleInit() {
    this.events.on('inbound.message', 'inbox-counts', () => this.schedule());
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  async countsFor(userId: string): Promise<InboxCountsDto> {
    const [views, tabs, labels] = await Promise.all([
      this.prisma.$queryRaw<Array<{ all: number; mine: number; unassigned: number; unread: number; starred: number; total_unread: number }>>`
        SELECT count(*)::int AS "all",
               (count(*) FILTER (WHERE c."assigneeId" = ${userId}::uuid))::int AS mine,
               (count(*) FILTER (WHERE c."assigneeId" IS NULL))::int AS unassigned,
               (count(*) FILTER (WHERE c."unreadCount" > 0))::int AS unread,
               (count(*) FILTER (WHERE c.starred))::int AS starred,
               COALESCE(sum(c."unreadCount"), 0)::int AS total_unread
        FROM "Conversation" c JOIN "Contact" ct ON ct.id = c."contactId"
        WHERE c.status = 'OPEN' AND ct."deletedAt" IS NULL`,
      this.prisma.$queryRaw<Array<{ status: 'OPEN' | 'SNOOZED' | 'DONE'; n: number }>>`
        SELECT c.status::text AS status, count(*)::int AS n
        FROM "Conversation" c JOIN "Contact" ct ON ct.id = c."contactId"
        WHERE ct."deletedAt" IS NULL GROUP BY c.status`,
      this.prisma.$queryRaw<Array<{ label_id: string; n: number }>>`
        SELECT l.label_id, count(DISTINCT l.cid)::int AS n FROM (
          SELECT cl."labelId" AS label_id, c.id AS cid FROM "Conversation" c
            JOIN "Contact" ct ON ct.id = c."contactId" JOIN "ContactLabel" cl ON cl."contactId" = ct.id
            WHERE c.status = 'OPEN' AND ct."deletedAt" IS NULL
          UNION ALL
          SELECT xl."labelId", c.id FROM "Conversation" c
            JOIN "Contact" ct ON ct.id = c."contactId" JOIN "ConversationLabel" xl ON xl."conversationId" = c.id
            WHERE c.status = 'OPEN' AND ct."deletedAt" IS NULL
        ) l GROUP BY l.label_id`,
    ]);
    const v = views[0] ?? { all: 0, mine: 0, unassigned: 0, unread: 0, starred: 0, total_unread: 0 };
    const t = { OPEN: 0, SNOOZED: 0, DONE: 0 };
    for (const r of tabs) t[r.status] = r.n;
    return {
      views: { all: v.all, mine: v.mine, unassigned: v.unassigned, unread: v.unread, starred: v.starred },
      byLabel: Object.fromEntries(labels.map((r) => [r.label_id, r.n])),
      tabs: t,
      totalUnread: v.total_unread,
    };
  }

  /** Programa la emisión de `badge.counts` (agrupa ráfagas). */
  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.emitNow();
    }, DEBOUNCE_MS);
    this.timer.unref?.();
  }

  /** Emite ya los contadores a cada usuario activo («Asignadas a mí» depende de la persona). */
  async emitNow() {
    try {
      const users = await this.prisma.user.findMany({ where: { active: true }, select: { id: true } });
      for (const u of users) this.realtime.emitToUser(u.id, 'badge.counts', await this.countsFor(u.id));
    } catch (e) {
      this.log.warn(`No se pudieron emitir los contadores: ${(e as Error).message}`);
    }
  }
}

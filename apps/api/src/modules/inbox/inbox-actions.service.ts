import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, type ConversationEventType } from '@prisma/client';
import { zonedParts, zonedTimeToUtc, type MessageDto, type SendMessageDto, type SnoozeDto } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { JobsService, QUEUES } from '../jobs/jobs.service';
import { MessageNotifier } from '../whatsapp/message-notifier.service';
import { MessagingService } from '../whatsapp/messaging.service';
import { CountsService } from './counts.service';
import { previewFor } from './mappers';

const HOUR = 3600_000;

/** Calcula el instante de despertar de «Posponer» (hora de Madrid, con cambio de hora). */
export function snoozeUntil(dto: SnoozeDto, now = new Date()): Date {
  const addDays = (ymd: string, n: number) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
  };
  switch (dto.preset) {
    case 'tomorrow8':
      return zonedTimeToUtc(addDays(zonedParts(now).ymd, 1), '08:00');
    case 'monday8': {
      const p = zonedParts(now);
      const idx = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(p.weekday);
      return zonedTimeToUtc(addDays(p.ymd, 7 - idx), '08:00'); // lunes siguiente (si hoy es lunes, el de la semana que viene)
    }
    case '1h': return new Date(now.getTime() + HOUR);
    case '1d': return new Date(now.getTime() + 24 * HOUR);
    case '1w': return new Date(now.getTime() + 7 * 24 * HOUR);
    case 'custom': {
      if (!dto.until) throw new BadRequestException({ statusCode: 400, message: 'Indica hasta cuándo posponer' });
      const d = new Date(dto.until);
      if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) throw new BadRequestException({ statusCode: 400, message: 'La fecha para posponer debe ser futura' });
      return d;
    }
  }
}

@Injectable()
export class InboxActionsService implements OnModuleInit {
  private readonly log = new Logger('InboxActions');
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly notifier: MessageNotifier,
    private readonly counts: CountsService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register(QUEUES.CRON_MINUTE, async () => void (await this.wakeSnoozed()), {}, 'inbox-wake-snoozed');
  }

  private async load(id: string) {
    const c = await this.prisma.conversation.findUnique({ where: { id } });
    if (!c) throw new NotFoundException({ statusCode: 404, message: 'Conversación no encontrada' });
    return c;
  }

  /** Aplica un cambio + su evento en el historial y avisa por WebSocket. */
  private async record(conversationId: string, type: ConversationEventType, actorId: string | null, data: Prisma.InputJsonValue | null, update: Prisma.ConversationUpdateInput = {}) {
    const ev = await this.prisma.$transaction(async (tx) => {
      if (Object.keys(update).length) await tx.conversation.update({ where: { id: conversationId }, data: update });
      return tx.conversationEvent.create({ data: { conversationId, type, actorId, data: data ?? Prisma.DbNull } });
    });
    await this.notifier.event(ev.id);
    await this.afterChange(conversationId);
    return ev;
  }

  private async afterChange(conversationId: string) {
    await this.notifier.conversation(conversationId);
    this.counts.schedule();
  }

  // ───────────────────────── Envío ─────────────────────────

  async send(conversationId: string, dto: SendMessageDto, userId: string): Promise<MessageDto> {
    const conv = await this.load(conversationId);
    let first: string;
    if (dto.type === 'note') {
      first = (await this.note(conv.id, dto.body, userId)).id;
    } else {
      if (dto.type === 'text') first = (await this.messaging.sendText(conversationId, dto.body, { userId, replyToMessageId: dto.replyToMessageId })).id;
      else if (dto.type === 'media') first = (await this.messaging.sendMedia(conversationId, dto.mediaFileIds, { caption: dto.caption, voice: dto.voice, userId }))[0]!.id;
      else first = (await this.messaging.sendTemplate(conversationId, dto.templateId, dto.params, { headerMediaFileId: dto.headerMediaFileId, userId })).id;
      await this.autoAssign(conversationId, userId);
    }
    const out = await this.notifier.messageDto(first);
    if (!out) throw new NotFoundException({ statusCode: 404, message: 'Mensaje no encontrado' });
    return out;
  }

  /** Nota interna (RF-2.18): nunca sale a WhatsApp. */
  private async note(conversationId: string, body: string, userId: string) {
    const now = new Date();
    const m = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: { conversationId, direction: 'INTERNAL', kind: 'NOTE', body, status: 'SENT', sentAt: now, sentById: userId },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: now, lastMessagePreview: previewFor('NOTE', body), lastMessageKind: 'NOTE', lastMessageDirection: 'INTERNAL' },
      });
      return msg;
    });
    await this.notifier.created(m.id, false);
    await this.afterChange(conversationId);
    return m;
  }

  /** RF-2.13: si nadie la tiene asignada, quien responde se la queda. */
  private async autoAssign(conversationId: string, userId: string) {
    const claimed = await this.prisma.conversation.updateMany({ where: { id: conversationId, assigneeId: null }, data: { assigneeId: userId } });
    if (!claimed.count) return;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const ev = await this.prisma.conversationEvent.create({
      data: { conversationId, type: 'ASSIGNED', actorId: userId, data: { assigneeId: userId, assigneeName: u?.name ?? null, auto: true } },
    });
    await this.notifier.event(ev.id);
    await this.afterChange(conversationId);
  }

  retry(conversationId: string, messageId: string, userId: string) {
    return this.messaging.retry(messageId, userId).then(async (m) => {
      if (m.conversationId !== conversationId) throw new NotFoundException({ statusCode: 404, message: 'Mensaje no encontrado' });
      return (await this.notifier.messageDto(m.id))!;
    });
  }

  // ───────────────────────── Acciones ─────────────────────────

  async assign(conversationId: string, assigneeId: string | null, actorId: string) {
    const conv = await this.load(conversationId);
    if (conv.assigneeId === assigneeId) return;
    if (assigneeId === null) {
      await this.record(conversationId, 'UNASSIGNED', actorId, { previousAssigneeId: conv.assigneeId }, { assignee: { disconnect: true } });
      return;
    }
    const u = await this.prisma.user.findUnique({ where: { id: assigneeId } });
    if (!u || !u.active) throw new BadRequestException({ statusCode: 400, message: 'Ese usuario no existe o está desactivado' });
    await this.record(conversationId, 'ASSIGNED', actorId, { assigneeId, assigneeName: u.name, previousAssigneeId: conv.assigneeId }, { assignee: { connect: { id: assigneeId } } });
  }

  async snooze(conversationId: string, dto: SnoozeDto, actorId: string) {
    await this.load(conversationId);
    const until = snoozeUntil(dto);
    const untilText = until.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' });
    await this.record(conversationId, 'SNOOZED', actorId, { preset: dto.preset, until: until.toISOString(), untilText }, { status: 'SNOOZED', snoozedUntil: until });
  }

  async done(conversationId: string, actorId: string) {
    const conv = await this.load(conversationId);
    if (conv.status === 'DONE') return;
    await this.record(conversationId, 'DONE', actorId, null, { status: 'DONE', snoozedUntil: null });
  }

  async reopen(conversationId: string, actorId: string) {
    const conv = await this.load(conversationId);
    if (conv.status === 'OPEN') return;
    await this.record(conversationId, 'REOPENED', actorId, { reason: 'manual' }, { status: 'OPEN', snoozedUntil: null });
  }

  async star(conversationId: string, starred: boolean, actorId: string) {
    const conv = await this.load(conversationId);
    if (conv.starred === starred) return;
    await this.record(conversationId, starred ? 'STARRED' : 'UNSTARRED', actorId, null, { starred });
  }

  async setLabels(conversationId: string, dto: { add: string[]; remove: string[] }, actorId: string) {
    const conv = await this.load(conversationId);
    const ids = [...new Set([...dto.add, ...dto.remove])];
    const labels = await this.prisma.label.findMany({ where: { id: { in: ids } } });
    const byId = new Map(labels.map((l) => [l.id, l]));
    for (const id of ids) {
      const l = byId.get(id);
      if (!l) throw new BadRequestException({ statusCode: 400, message: 'Etiqueta no encontrada' });
      if (l.scope !== 'CONVERSATION') throw new BadRequestException({ statusCode: 400, message: `«${l.name}» es una etiqueta de contacto, no de conversación` });
    }
    const current = new Set((await this.prisma.conversationLabel.findMany({ where: { conversationId: conv.id } })).map((x) => x.labelId));
    for (const id of dto.add) {
      if (current.has(id)) continue;
      await this.prisma.conversationLabel.create({ data: { conversationId, labelId: id } });
      current.add(id);
      const ev = await this.prisma.conversationEvent.create({ data: { conversationId, type: 'LABEL_ADDED', actorId, data: { labelId: id, labelName: byId.get(id)!.name } } });
      await this.notifier.event(ev.id);
    }
    for (const id of dto.remove) {
      if (!current.has(id) || dto.add.includes(id)) continue;
      await this.prisma.conversationLabel.delete({ where: { conversationId_labelId: { conversationId, labelId: id } } });
      current.delete(id);
      const ev = await this.prisma.conversationEvent.create({ data: { conversationId, type: 'LABEL_REMOVED', actorId, data: { labelId: id, labelName: byId.get(id)!.name } } });
      await this.notifier.event(ev.id);
    }
    await this.afterChange(conversationId);
  }

  async markUnread(conversationId: string) {
    const conv = await this.load(conversationId);
    if (conv.unreadCount > 0) return;
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { unreadCount: 1 } });
    await this.afterChange(conversationId);
  }

  /** RF-2.22: leído en la bandeja y doble check azul en WhatsApp. */
  async markRead(conversationId: string) {
    const conv = await this.load(conversationId);
    if (conv.unreadCount > 0) {
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
      await this.afterChange(conversationId);
    }
    await this.messaging.markConversationRead(conversationId);
  }

  // ───────────────────────── Despertar (cron) ─────────────────────────

  /** RF-2.15: las pospuestas vencidas vuelven a Abiertas. Devuelve cuántas. */
  async wakeSnoozed(now = new Date()): Promise<number> {
    const due = await this.prisma.conversation.findMany({ where: { status: 'SNOOZED', snoozedUntil: { lte: now } }, select: { id: true } });
    let n = 0;
    for (const { id } of due) {
      try {
        const upd = await this.prisma.conversation.updateMany({ where: { id, status: 'SNOOZED', snoozedUntil: { lte: now } }, data: { status: 'OPEN', snoozedUntil: null } });
        if (!upd.count) continue; // el cliente escribió mientras tanto
        const ev = await this.prisma.conversationEvent.create({ data: { conversationId: id, type: 'WOKE_UP', data: { reason: 'timer' } } });
        await this.notifier.event(ev.id);
        await this.notifier.conversation(id);
        n++;
      } catch (e) {
        this.log.error(`No se pudo despertar ${id}: ${(e as Error).message}`);
      }
    }
    if (n) this.counts.schedule();
    return n;
  }
}

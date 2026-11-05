import { Injectable, Logger } from '@nestjs/common';
import { isInVacation, isWithinBusinessHours } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { MessagingService } from '../whatsapp/messaging.service';
import { MessageNotifier } from '../whatsapp/message-notifier.service';
import type { DomainEventMap } from '../events/domain-events.service';

/**
 * Respuesta automática fuera de horario y vacaciones (RF-7.2/7.3, docs/06).
 * Decide solo con la hora del mensaje entrante (`at`), así se puede probar con cualquier reloj.
 * Al pulsar un botón (OOH_PEDIDO…) se etiqueta la conversación con la etiqueta configurada (decisión del MVP:
 * se etiqueta directamente, sin pedir confirmación).
 */
@Injectable()
export class AutoReplyService {
  private readonly log = new Logger('AutoReply');
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly messaging: MessagingService,
    private readonly notifier: MessageNotifier,
  ) {}

  async onInbound(p: DomainEventMap['inbound.message']) {
    if (p.buttonPayload) await this.labelFromButton(p);
    await this.maybeReply(p);
  }

  /** ¿Toca responder? Devuelve el mensaje enviado o null. */
  async maybeReply(p: DomainEventMap['inbound.message']) {
    if (p.optedOut || p.kind === 'REACTION') return null;
    const [bh, ooh, vac] = await Promise.all([this.settings.get('business_hours'), this.settings.get('out_of_hours'), this.settings.get('vacation')]);
    const onVacation = isInVacation(p.at, vac, bh.timezone);
    const closed = !isWithinBusinessHours(p.at, bh);
    // Vacaciones tiene prioridad (y usa su texto); si no, fuera de horario
    let text: string | null = null;
    let buttons: Array<{ id: string; title: string }> = [];
    if (onVacation && vac.text.trim()) text = vac.text;
    else if (closed && ooh.enabled) {
      text = ooh.text;
      buttons = ooh.buttons.map((b) => ({ id: b.id, title: b.title }));
    }
    if (!text) return null;

    const conv = await this.prisma.conversation.findUnique({ where: { id: p.conversationId }, select: { lastAutoReplyAt: true } });
    if (!conv) return null;
    // No contestar a una respuesta a nuestro propio botón: el contacto ya está hablando con nosotros
    if (p.buttonPayload && buttons.some((b) => b.id === p.buttonPayload)) return null;
    const minMs = Math.max(1, ooh.minHoursBetween) * 3600_000;
    if (conv.lastAutoReplyAt && p.at.getTime() - conv.lastAutoReplyAt.getTime() < minMs) return null;

    // Reserva atómica de `lastAutoReplyAt` (dos mensajes seguidos no generan dos respuestas)
    const limit = new Date(p.at.getTime() - minMs);
    const claimed = await this.prisma.conversation.updateMany({
      where: { id: p.conversationId, OR: [{ lastAutoReplyAt: null }, { lastAutoReplyAt: { lte: limit } }] },
      data: { lastAutoReplyAt: p.at },
    });
    if (!claimed.count) return null;
    try {
      return buttons.length ? await this.messaging.sendInteractiveButtons(p.conversationId, text, buttons, { kind: 'AUTO_REPLY' }) : await this.messaging.sendAutoReply(p.conversationId, text);
    } catch (e) {
      // Ventana cerrada o error de envío: se libera la reserva para no perder la próxima
      await this.prisma.conversation.updateMany({ where: { id: p.conversationId, lastAutoReplyAt: p.at }, data: { lastAutoReplyAt: null } });
      this.log.warn(`Respuesta automática no enviada (${p.conversationId}): ${(e as Error).message}`);
      return null;
    }
  }

  /** Botón de la respuesta automática → etiqueta de conversación con evento LABEL_ADDED. */
  private async labelFromButton(p: DomainEventMap['inbound.message']) {
    const ooh = await this.settings.get('out_of_hours');
    const btn = ooh.buttons.find((b) => b.id === p.buttonPayload);
    if (!btn?.labelName) return;
    const label = await this.prisma.label.findFirst({ where: { name: btn.labelName.toUpperCase(), scope: 'CONVERSATION' } });
    if (!label) return;
    const already = await this.prisma.conversationLabel.findUnique({ where: { conversationId_labelId: { conversationId: p.conversationId, labelId: label.id } } });
    if (already) return;
    await this.prisma.conversationLabel.create({ data: { conversationId: p.conversationId, labelId: label.id } });
    const ev = await this.prisma.conversationEvent.create({
      data: { conversationId: p.conversationId, type: 'LABEL_ADDED', actorId: null, data: { labelId: label.id, labelName: label.name, source: 'auto_reply_button' } },
    });
    await this.notifier.event(ev.id);
    await this.notifier.conversation(p.conversationId);
  }
}

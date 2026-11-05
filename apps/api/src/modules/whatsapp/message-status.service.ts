import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Message } from '@prisma/client';
import { META_ERRORS, canAdvanceStatus, metaErrorInfo, type MessageStatus, type WaStatus } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { DomainEvents } from '../events/domain-events.service';
import { ConsentService } from '../contacts/consent.service';
import { MessageNotifier } from './message-notifier.service';

const STATUS_MAP: Record<string, MessageStatus | undefined> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };

/** Error de que el estado llegó antes de guardar el wamid: el job se reintenta con espera. */
export class StatusBeforeMessageError extends Error {
  constructor(wamid: string) {
    super(`Estado recibido antes de guardar el mensaje ${wamid}; se reintentará`);
  }
}

/**
 * Aplica los cambios de estado de los mensajes salientes (webhook `statuses[]` y fallos del propio envío)
 * y las acciones por código de error de docs/06.
 */
@Injectable()
export class MessageStatusService {
  private readonly log = new Logger('MessageStatus');
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly consent: ConsentService,
    private readonly notifier: MessageNotifier,
  ) {}

  /** Guarda el wamid de la respuesta del envío y pasa a SENT al momento. */
  async markSent(messageId: string, wamid: string): Promise<Message> {
    const now = new Date();
    const m = await this.prisma.message.update({ where: { id: messageId }, data: { wamid, status: 'SENT', sentAt: now, errorCode: null, errorTitle: null, errorDetails: null } });
    await this.publish(m, now);
    return m;
  }

  /** Marca un saliente como FAILED (envío rechazado o estado `failed`) y ejecuta las acciones por código. */
  async markFailed(messageId: string, err: { code: number | null; title: string | null; details?: string | null }, at = new Date()): Promise<Message> {
    const info = err.code != null ? metaErrorInfo(err.code) : null;
    const known = err.code != null && META_ERRORS[err.code];
    const m = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        status: 'FAILED',
        failedAt: at,
        errorCode: err.code || null,
        errorTitle: (known ? info!.es : err.title) ?? 'Error al enviar el mensaje',
        errorDetails: err.details ?? null,
      },
    });
    await this.runErrorActions(m);
    await this.publish(m, at);
    return m;
  }

  /**
   * Aplica un `statuses[]` del webhook. Lanza StatusBeforeMessageError si aún no existe el mensaje.
   * Devuelve el mensaje y si el estado avanzó.
   */
  async applyWebhookStatus(s: WaStatus): Promise<{ message: Message; advanced: boolean } | null> {
    const next = STATUS_MAP[s.status];
    if (!next) return null; // 'deleted' y desconocidos: se ignoran
    const msg = await this.prisma.message.findUnique({ where: { wamid: s.id } });
    if (!msg) throw new StatusBeforeMessageError(s.id);
    const at = new Date(Number(s.timestamp) * 1000);
    const when = Number.isNaN(at.getTime()) ? new Date() : at;

    const data: Prisma.MessageUpdateInput = {};
    // El precio llega con cualquier estado (normalmente sent/delivered): se guarda siempre que venga
    if (s.pricing) {
      if (s.pricing.category) data.pricingCategory = s.pricing.category;
      if (typeof s.pricing.billable === 'boolean') data.billable = s.pricing.billable;
    }
    // Las fechas se completan aunque el estado llegue tarde (no retroceden, pero no se pierden)
    if (next === 'SENT' && !msg.sentAt) data.sentAt = when;
    if (next === 'DELIVERED' && !msg.deliveredAt) data.deliveredAt = when;
    if (next === 'READ' && !msg.readAt) data.readAt = when;

    const advanced = canAdvanceStatus(msg.status as MessageStatus, next);
    if (advanced) data.status = next;

    if (next === 'FAILED' && advanced) {
      const e = s.errors?.[0];
      const code = e?.code ?? null;
      await this.prisma.message.update({ where: { id: msg.id }, data });
      const m = await this.markFailed(msg.id, { code, title: e?.title ?? e?.message ?? null, details: e?.error_data?.details ?? e?.message ?? null }, when);
      return { message: m, advanced: true };
    }

    const m = Object.keys(data).length ? await this.prisma.message.update({ where: { id: msg.id }, data }) : msg;
    if (advanced || data.pricingCategory || data.billable != null) await this.publish(m, when, advanced);
    return { message: m, advanced };
  }

  /** WebSocket + evento interno `message.status` (lo usa campañas). */
  private async publish(m: Message, at: Date, emitDomain = true) {
    this.notifier.status(m, at);
    if (!emitDomain) return;
    await this.events.emit('message.status', {
      messageId: m.id,
      conversationId: m.conversationId,
      campaignId: m.campaignId,
      status: m.status as MessageStatus,
      errorCode: m.errorCode,
      errorTitle: m.errorTitle,
      at,
      pricingCategory: m.pricingCategory,
      billable: m.billable,
    });
  }

  /** Acciones por código de error (tabla de docs/06). */
  private async runErrorActions(m: Message) {
    const code = m.errorCode;
    if (code == null) return;
    const info = metaErrorInfo(code);
    const contactId = (await this.prisma.conversation.findUnique({ where: { id: m.conversationId }, select: { contactId: true } }))?.contactId;
    try {
      switch (code) {
        case 131050: // el usuario paró el marketing → baja
          if (contactId) await this.consent.setConsent(contactId, 'REVOKED', 'META_ERROR_131050', { messageId: m.id, campaignId: m.campaignId });
          break;
        case 131026: {
          // No entregable: a la segunda vez, teléfono inválido
          if (!contactId) break;
          const times = await this.prisma.message.count({ where: { conversation: { contactId }, status: 'FAILED', errorCode: 131026 } });
          if (times >= 2) await this.prisma.contact.update({ where: { id: contactId }, data: { phoneInvalid: true } });
          break;
        }
        case 368:
        case 131031:
        case 133010:
          await this.events.emit('sending.blocked', { code, scope: 'all', campaignId: m.campaignId, templateId: m.templateId, message: info.es });
          break;
        case 132015:
        case 132001:
          await this.events.emit('sending.blocked', { code, scope: 'campaign', campaignId: m.campaignId, templateId: m.templateId, message: info.es });
          break;
        case 131051:
          this.log.error(`Meta rechazó el tipo de mensaje (131051) en ${m.id}: error de programación`);
          break;
      }
    } catch (e) {
      this.log.error(`Acción del error ${code} falló: ${(e as Error)?.stack ?? e}`);
    }
  }
}

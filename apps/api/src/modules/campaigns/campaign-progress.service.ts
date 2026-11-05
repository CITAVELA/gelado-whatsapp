import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, type Message } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { DomainEvents } from '../events/domain-events.service';
import { RealtimeService } from '../realtime/realtime.gateway';
import { CampaignClock } from './campaigns.clock';

/** Una respuesta o baja cuenta para la campaña si llega dentro de este plazo desde el envío (RF-5.9). */
export const REPLY_WINDOW_MS = 72 * 3600_000;
const RANK: Record<string, number> = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4 };

/**
 * Seguimiento de campañas: aplica los estados de los mensajes a los destinatarios, marca respuestas y bajas
 * y RECALCULA los contadores de la campaña desde `CampaignRecipient` (regla 6 de 05; nunca se incrementan).
 */
@Injectable()
export class CampaignProgressService implements OnModuleInit {
  private readonly log = new Logger('CampaignProgress');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly realtime: RealtimeService,
    private readonly clock: CampaignClock,
  ) {}

  onModuleInit() {
    this.events.on('message.status', 'campaigns-tracking', (p) => this.onMessageStatus(p));
    this.events.on('inbound.message', 'campaigns-replies', (p) => this.onInbound(p));
    this.events.on('contact.opted_out', 'campaigns-optout', (p) => this.onOptedOut(p));
  }

  // ───────────────────────── Contadores ─────────────────────────

  /** Recalcula los contadores desde los destinatarios, completa la campaña si no queda nada pendiente y avisa por WebSocket. */
  async recompute(campaignId: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
      SELECT
        count(*) FILTER (WHERE "status" <> 'SKIPPED')::int AS total,
        count(*) FILTER (WHERE "status" IN ('SENT','DELIVERED','READ') OR ("status" = 'FAILED' AND "sentAt" IS NOT NULL))::int AS sent,
        count(*) FILTER (WHERE "status" IN ('DELIVERED','READ') OR "deliveredAt" IS NOT NULL OR "readAt" IS NOT NULL)::int AS delivered,
        count(*) FILTER (WHERE "status" = 'READ' OR "readAt" IS NOT NULL)::int AS read,
        count(*) FILTER (WHERE "repliedAt" IS NOT NULL)::int AS replied,
        count(*) FILTER (WHERE "status" = 'FAILED')::int AS failed,
        count(*) FILTER (WHERE "status" = 'SKIPPED')::int AS skipped,
        count(*) FILTER (WHERE "optedOutAt" IS NOT NULL)::int AS optout,
        count(*) FILTER (WHERE "status" IN ('QUEUED','SENDING'))::int AS pending
      FROM "CampaignRecipient" WHERE "campaignId" = ${campaignId}::uuid`);
    const r = rows[0]!;
    const c = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true, startedAt: true, totalRecipients: true } });
    if (!c) return;
    // Programada o borrador sin destinatarios materializados: se conserva la previsión guardada
    const materialized = r.total + r.skipped > 0;
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: materialized
        ? { totalRecipients: r.total, sentCount: r.sent, deliveredCount: r.delivered, readCount: r.read, repliedCount: r.replied, failedCount: r.failed, skippedCount: r.skipped, optOutCount: r.optout }
        : {},
    });
    let status = c.status as string;
    if (materialized && c.status === 'RUNNING' && r.pending === 0) {
      const done = await this.prisma.campaign.updateMany({ where: { id: campaignId, status: 'RUNNING' }, data: { status: 'COMPLETED', completedAt: this.clock.now() } });
      if (done.count) status = 'COMPLETED';
    }
    this.realtime.emit('campaign.progress', { campaignId, status, sentCount: materialized ? r.sent : 0, totalRecipients: materialized ? r.total : c.totalRecipients });
  }

  // ───────────────────────── Estados de mensaje ─────────────────────────

  /** Destinatario de un mensaje: por messageId o, si aún no está enlazado, por campaña + conversación. */
  private async recipientFor(campaignId: string, conversationId: string, messageId: string) {
    const byMsg = await this.prisma.campaignRecipient.findUnique({ where: { messageId } });
    if (byMsg) return byMsg;
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { contactId: true } });
    if (!conv) return null;
    return this.prisma.campaignRecipient.findUnique({ where: { campaignId_contactId: { campaignId, contactId: conv.contactId } } });
  }

  /** Copia el estado del mensaje al destinatario. Los estados solo avanzan; el mensaje es la fuente de verdad. */
  async syncFromMessage(recipientId: string, msg: Message): Promise<void> {
    const r = await this.prisma.campaignRecipient.findUnique({ where: { id: recipientId } });
    if (!r) return;
    // Cancelada mientras se enviaba: si el mensaje llegó a salir, el destinatario vuelve a contar como enviado
    const cancelledButSent = r.status === 'SKIPPED' && r.skipReason === 'CANCELLED';
    if (r.status === 'SKIPPED' && !cancelledButSent) return;
    const data: Prisma.CampaignRecipientUpdateInput = {};
    if (!r.messageId) data.message = { connect: { id: msg.id } };
    const readAt = msg.readAt ?? r.readAt;
    const deliveredAt = msg.deliveredAt ?? r.deliveredAt ?? readAt;
    const sentAt = msg.sentAt ?? r.sentAt ?? deliveredAt;
    if (sentAt && !r.sentAt) data.sentAt = sentAt;
    if (deliveredAt && !r.deliveredAt) data.deliveredAt = deliveredAt;
    if (readAt && !r.readAt) data.readAt = readAt;

    if (msg.status === 'FAILED') {
      data.status = 'FAILED';
      if (cancelledButSent) data.skipReason = null;
      data.errorCode = msg.errorCode;
      data.errorTitle = msg.errorTitle;
    } else {
      const derived = msg.status === 'READ' ? 'READ' : msg.status === 'DELIVERED' ? 'DELIVERED' : msg.status === 'SENT' ? 'SENT' : 'SENDING';
      // Un destinatario FAILED no vuelve atrás salvo reintento (el mensaje vuelve a PENDING/SENT)
      const cur = r.status === 'FAILED' || cancelledButSent ? -1 : (RANK[r.status] ?? 0);
      if ((RANK[derived] ?? 0) > cur) {
        data.status = derived;
        if (cancelledButSent) data.skipReason = null;
        if (r.status === 'FAILED') {
          data.errorCode = null;
          data.errorTitle = null;
        }
      }
    }
    if (Object.keys(data).length) await this.prisma.campaignRecipient.update({ where: { id: r.id }, data });
  }

  private async onMessageStatus(p: { messageId: string; conversationId: string; campaignId: string | null }) {
    if (!p.campaignId) return;
    const r = await this.recipientFor(p.campaignId, p.conversationId, p.messageId);
    if (!r) return;
    const msg = await this.prisma.message.findUnique({ where: { id: p.messageId } });
    if (!msg) return;
    await this.syncFromMessage(r.id, msg);
    await this.recompute(p.campaignId);
  }

  // ───────────────────────── Respuestas y bajas ─────────────────────────

  /** Recibo de campaña más reciente enviado a este contacto dentro del plazo anterior a `at`. */
  private latestSent(contactId: string, since: Date, windowMs: number, until?: Date) {
    return this.prisma.campaignRecipient.findFirst({
      where: { contactId, sentAt: { not: null, gte: new Date(since.getTime() - windowMs), ...(until ? { lte: until } : {}) } },
      orderBy: { sentAt: 'desc' },
    });
  }

  private async onInbound(p: { conversationId: string; contactId: string; at: Date; optedOut: boolean }) {
    if (p.optedOut) return; // pulsar «No recibir más» es una baja, no una respuesta
    // +60 s de margen: el reloj de Meta y el nuestro pueden diferir unos segundos
    const r = await this.latestSent(p.contactId, p.at, REPLY_WINDOW_MS, new Date(p.at.getTime() + 60_000));
    if (!r) return;
    // RF-5.9: la conversación queda marcada con el nombre de la campaña a la que responde
    await this.prisma.conversation.update({ where: { id: p.conversationId }, data: { lastCampaignId: r.campaignId } });
    if (r.repliedAt) return;
    await this.prisma.campaignRecipient.update({ where: { id: r.id }, data: { repliedAt: p.at } });
    await this.recompute(r.campaignId);
  }

  private async onOptedOut(p: { contactId: string; campaignId?: string | null }) {
    const now = this.clock.now();
    const touched = new Set<string>();
    // Baja atribuida a la campaña que se la provocó
    const r = p.campaignId
      ? await this.prisma.campaignRecipient.findUnique({ where: { campaignId_contactId: { campaignId: p.campaignId, contactId: p.contactId } } })
      : await this.latestSent(p.contactId, now, 7 * 24 * 3600_000);
    if (r && !r.optedOutAt) {
      await this.prisma.campaignRecipient.update({ where: { id: r.id }, data: { optedOutAt: now } });
      touched.add(r.campaignId);
    }
    // Lo que aún está en cola para este contacto se omite (lo que ya se está enviando lo frena sendOne al comprobar la baja)
    const pending = await this.prisma.campaignRecipient.findMany({
      where: { contactId: p.contactId, status: 'QUEUED', campaign: { status: { in: ['SCHEDULED', 'RUNNING', 'PAUSED'] } } },
      select: { id: true, campaignId: true },
    });
    for (const q of pending) {
      const u = await this.prisma.campaignRecipient.updateMany({ where: { id: q.id, status: 'QUEUED' }, data: { status: 'SKIPPED', skipReason: 'REVOKED' } });
      if (u.count) touched.add(q.campaignId);
    }
    for (const id of touched) await this.recompute(id);
  }
}

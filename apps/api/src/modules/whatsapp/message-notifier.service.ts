import { Injectable } from '@nestjs/common';
import type { MessageDto } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.gateway';
import { MediaService } from '../media/media.service';
import { conversationInclude, messageInclude, toConversationListItem, toEventDto, toMessageDto } from '../inbox/mappers';

/** Emite por WebSocket los mensajes, conversaciones y estados (DTO de @gelado/shared). */
@Injectable()
export class MessageNotifier {
  constructor(private readonly prisma: PrismaService, private readonly realtime: RealtimeService, private readonly media: MediaService) {}

  /** DTO de un mensaje (con adjunto firmado y mensaje citado). */
  async messageDto(messageId: string): Promise<MessageDto | null> {
    const m = await this.prisma.message.findUnique({ where: { id: messageId }, include: messageInclude });
    if (!m) return null;
    const quoted = m.contextWamid
      ? await this.prisma.message.findUnique({ where: { wamid: m.contextWamid }, include: messageInclude })
      : null;
    return toMessageDto(m, this.media.signedUrl, { quoted });
  }

  /** `message.created`. `notify` = true solo para entrantes nuevos (suena y avisa); false al refrescar. */
  async created(messageId: string, notify = false) {
    const message = await this.messageDto(messageId);
    if (message) this.realtime.emit('message.created', { conversationId: message.conversationId, message, notify });
  }

  async conversation(conversationId: string) {
    const c = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: conversationInclude });
    if (!c) return;
    const camp = c.lastCampaignId ? await this.prisma.campaign.findUnique({ where: { id: c.lastCampaignId }, select: { name: true } }) : null;
    this.realtime.emit('conversation.updated', { conversation: toConversationListItem(c, { lastCampaignName: camp?.name ?? null }) });
  }

  async event(eventId: string) {
    const e = await this.prisma.conversationEvent.findUnique({ where: { id: eventId }, include: { actor: { select: { id: true, name: true } } } });
    if (e) this.realtime.emit('event.created', { conversationId: e.conversationId, event: toEventDto(e) });
  }

  status(m: { id: string; conversationId: string; status: any; errorCode: number | null; errorTitle: string | null }, at = new Date()) {
    this.realtime.emit('message.status', { conversationId: m.conversationId, messageId: m.id, status: m.status, errorCode: m.errorCode, errorTitle: m.errorTitle, at: at.toISOString() });
  }
}

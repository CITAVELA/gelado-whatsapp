// Eventos de tiempo real (socket.io, ruta /ws). El servidor emite a todos los usuarios conectados.
import type { AlertDto } from './quality';
import type { ConversationListItemDto, InboxCountsDto, MessageDto, ConversationEventDto } from './inbox';
import type { MessageStatus } from './enums';

export const WS_PATH = '/ws';

export interface ServerToClientEvents {
  'conversation.updated': (p: { conversation: ConversationListItemDto }) => void;
  'message.created': (p: { conversationId: string; message: MessageDto; notify: boolean }) => void;
  'message.status': (p: { conversationId: string; messageId: string; status: MessageStatus; errorCode: number | null; errorTitle: string | null; at: string }) => void;
  'event.created': (p: { conversationId: string; event: ConversationEventDto }) => void;
  'badge.counts': (p: InboxCountsDto) => void;
  alert: (p: { alerts: AlertDto[] }) => void;
  'campaign.progress': (p: { campaignId: string; status: string; sentCount: number; totalRecipients: number }) => void;
  'template.updated': (p: { templateId: string; status: string }) => void;
}

export interface ClientToServerEvents {
  /** el usuario está viendo esta conversación (para no notificar) */
  'conversation.focus': (p: { conversationId: string | null }) => void;
}

export type WsEventName = keyof ServerToClientEvents;

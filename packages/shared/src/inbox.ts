import { z } from 'zod';
import type { ConversationEventType, ConversationStatus, MessageDirection, MessageKind, MessageStatus } from './enums';
import type { LabelDto } from './labels';

export type InboxView = 'all' | 'mine' | 'unassigned' | 'unread' | 'starred';

export const conversationListQuerySchema = z.object({
  view: z.enum(['all', 'mine', 'unassigned', 'unread', 'starred']).default('all'),
  status: z.enum(['OPEN', 'SNOOZED', 'DONE']).default('OPEN'),
  /** vista por etiqueta de contacto (tipo de cliente) o de conversación (tema) */
  labelId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  conversationLabelId: z.string().uuid().optional(),
  q: z.string().trim().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

export interface UserMiniDto { id: string; name: string; initials: string }

export interface ConversationListItemDto {
  id: string;
  contactId: string;
  displayName: string;
  phoneE164: string;
  status: ConversationStatus;
  snoozedUntil: string | null;
  assignee: UserMiniDto | null;
  starred: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageKind: MessageKind | null;
  lastMessageDirection: MessageDirection | null;
  windowExpiresAt: string | null;
  contactLabels: LabelDto[];
  conversationLabels: LabelDto[];
  lastCampaignName: string | null;
  /** coincidencia de búsqueda en el texto de un mensaje */
  searchSnippet?: string | null;
}

export interface ConversationDetailDto extends ConversationListItemDto {
  lastInboundAt: string | null;
  windowOpen: boolean;
  contact: import('./contacts').ContactDto;
}

export interface MediaDto {
  id: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string | null;
  /** URL firmada de corta duración (1 h) */
  url: string | null;
  /** el adjunto entrante aún se está descargando */
  pending?: boolean;
}

export interface ReactionDto { emoji: string; direction: MessageDirection; at: string }

export interface MessageDto {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  kind: MessageKind;
  body: string | null;
  media: MediaDto | null;
  templateName: string | null;
  templateParams: unknown | null;
  payload: unknown | null;      // ubicación, contactos, botón, reacción…
  wamid: string | null;
  contextWamid: string | null;
  quoted: { id: string; body: string | null; kind: MessageKind; direction: MessageDirection } | null;
  reactions: ReactionDto[];
  status: MessageStatus;
  errorCode: number | null;
  errorTitle: string | null;    // ya en español
  retryable: boolean;
  sentBy: UserMiniDto | null;
  campaignId: string | null;
  campaignName: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface ConversationEventDto {
  id: string;
  conversationId: string;
  type: ConversationEventType;
  actor: UserMiniDto | null;
  data: unknown;
  /** frase lista para mostrar: «María asignó a Cristina» */
  text: string;
  createdAt: string;
}

/** Elemento del historial: mensaje o evento del sistema, ordenados por fecha. */
export type TimelineItemDto =
  | { type: 'message'; at: string; message: MessageDto }
  | { type: 'event'; at: string; event: ConversationEventDto };

export interface InboxCountsDto {
  views: Record<InboxView, number>;              // solo conversaciones OPEN
  byLabel: Record<string, number>;               // labelId → abiertas
  tabs: Record<ConversationStatus, number>;
  totalUnread: number;                           // para el título de la pestaña
}

// ── Acciones ──

export const sendTextSchema = z.object({
  type: z.literal('text'),
  body: z.string().trim().min(1).max(4096),
  replyToMessageId: z.string().uuid().optional(),
});
export const sendMediaSchema = z.object({
  type: z.literal('media'),
  /** MediaFile ya subido (POST /api/media) o de la biblioteca */
  mediaFileIds: z.array(z.string().uuid()).min(1).max(10),
  caption: z.string().max(1024).optional(),
  /** true si el audio es una nota de voz grabada en el navegador */
  voice: z.boolean().optional(),
});
export const sendTemplateSchema = z.object({
  type: z.literal('template'),
  templateId: z.string().uuid(),
  /** { "body.1": "Ginés", "header.1": "…", "button.0": "sufijo-url" } */
  params: z.record(z.string(), z.string()).default({}),
  headerMediaFileId: z.string().uuid().optional(),
});
export const sendNoteSchema = z.object({ type: z.literal('note'), body: z.string().trim().min(1).max(4096) });
export const sendMessageSchema = z.discriminatedUnion('type', [sendTextSchema, sendMediaSchema, sendTemplateSchema, sendNoteSchema]);
export type SendMessageDto = z.infer<typeof sendMessageSchema>;

export const assignSchema = z.object({ assigneeId: z.string().uuid().nullable() });
export const snoozeSchema = z.object({
  preset: z.enum(['tomorrow8', 'monday8', '1h', '1d', '1w', 'custom']),
  until: z.string().datetime().optional(),   // requerido si preset = custom
});
export type SnoozeDto = z.infer<typeof snoozeSchema>;
export const conversationLabelsSchema = z.object({ add: z.array(z.string().uuid()).default([]), remove: z.array(z.string().uuid()).default([]) });
export const starSchema = z.object({ starred: z.boolean() });
export const newConversationSchema = z
  .object({ phone: z.string().min(3).optional(), contactId: z.string().uuid().optional(), firstName: z.string().optional() })
  .refine((v) => !!v.phone || !!v.contactId, { message: 'Indica un teléfono o un contacto' });

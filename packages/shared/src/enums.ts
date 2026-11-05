// Enumeraciones del dominio. Deben coincidir con los enums de apps/api/prisma/schema.prisma.

export const Role = { ADMIN: 'ADMIN', AGENT: 'AGENT' } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ConsentStatus = { UNKNOWN: 'UNKNOWN', GRANTED: 'GRANTED', REVOKED: 'REVOKED' } as const;
export type ConsentStatus = (typeof ConsentStatus)[keyof typeof ConsentStatus];

export const ConsentSource = {
  IMPORT: 'IMPORT',
  MANUAL: 'MANUAL',
  WHATSAPP_BUTTON: 'WHATSAPP_BUTTON',
  WHATSAPP_KEYWORD: 'WHATSAPP_KEYWORD',
  META_ERROR_131050: 'META_ERROR_131050',
  LEGACY_LABEL: 'LEGACY_LABEL',
  CAMPAIGN_DECLARATION: 'CAMPAIGN_DECLARATION',
} as const;
export type ConsentSource = (typeof ConsentSource)[keyof typeof ConsentSource];

export const LabelScope = { CONTACT: 'CONTACT', CONVERSATION: 'CONVERSATION' } as const;
export type LabelScope = (typeof LabelScope)[keyof typeof LabelScope];

export const ConversationStatus = { OPEN: 'OPEN', SNOOZED: 'SNOOZED', DONE: 'DONE' } as const;
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

export const MessageDirection = { INBOUND: 'INBOUND', OUTBOUND: 'OUTBOUND', INTERNAL: 'INTERNAL' } as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

export const MessageKind = {
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  AUDIO: 'AUDIO',
  VOICE: 'VOICE',
  VIDEO: 'VIDEO',
  DOCUMENT: 'DOCUMENT',
  STICKER: 'STICKER',
  LOCATION: 'LOCATION',
  CONTACTS: 'CONTACTS',
  BUTTON_REPLY: 'BUTTON_REPLY',
  REACTION: 'REACTION',
  TEMPLATE: 'TEMPLATE',
  AUTO_REPLY: 'AUTO_REPLY',
  NOTE: 'NOTE',
  UNSUPPORTED: 'UNSUPPORTED',
} as const;
export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind];

export const MessageStatus = {
  RECEIVED: 'RECEIVED',
  PENDING: 'PENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

/** Orden de avance de los estados salientes (regla 4 de 05). FAILED gana a todo. */
export const MESSAGE_STATUS_RANK: Record<MessageStatus, number> = {
  RECEIVED: 0,
  PENDING: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: 99,
};

/** Devuelve true si `next` puede sustituir a `current` (los estados solo avanzan; FAILED gana). */
export function canAdvanceStatus(current: MessageStatus, next: MessageStatus): boolean {
  if (current === 'FAILED') return false;
  if (next === 'FAILED') return true;
  return MESSAGE_STATUS_RANK[next] > MESSAGE_STATUS_RANK[current];
}

export const ConversationEventType = {
  ASSIGNED: 'ASSIGNED',
  UNASSIGNED: 'UNASSIGNED',
  SNOOZED: 'SNOOZED',
  WOKE_UP: 'WOKE_UP',
  DONE: 'DONE',
  REOPENED: 'REOPENED',
  LABEL_ADDED: 'LABEL_ADDED',
  LABEL_REMOVED: 'LABEL_REMOVED',
  STARRED: 'STARRED',
  UNSTARRED: 'UNSTARRED',
  CONSENT_CHANGED: 'CONSENT_CHANGED',
} as const;
export type ConversationEventType = (typeof ConversationEventType)[keyof typeof ConversationEventType];

export const MediaSource = { INBOUND: 'INBOUND', UPLOAD: 'UPLOAD', LIBRARY: 'LIBRARY', TEMPLATE_EXAMPLE: 'TEMPLATE_EXAMPLE' } as const;
export type MediaSource = (typeof MediaSource)[keyof typeof MediaSource];

export const TemplateCategory = { MARKETING: 'MARKETING', UTILITY: 'UTILITY', AUTHENTICATION: 'AUTHENTICATION' } as const;
export type TemplateCategory = (typeof TemplateCategory)[keyof typeof TemplateCategory];

export const TemplateStatus = {
  LOCAL_DRAFT: 'LOCAL_DRAFT',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PAUSED: 'PAUSED',
  DISABLED: 'DISABLED',
  IN_APPEAL: 'IN_APPEAL',
  DELETED: 'DELETED',
} as const;
export type TemplateStatus = (typeof TemplateStatus)[keyof typeof TemplateStatus];

export const CampaignStatus = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

export const RecipientStatus = {
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type RecipientStatus = (typeof RecipientStatus)[keyof typeof RecipientStatus];

export const SkipReason = {
  REVOKED: 'REVOKED',
  PHONE_INVALID: 'PHONE_INVALID',
  DAILY_LIMIT: 'DAILY_LIMIT',
  DUPLICATE: 'DUPLICATE',
  DELETED: 'DELETED',
} as const;
export type SkipReason = (typeof SkipReason)[keyof typeof SkipReason];

/** Textos en español para chips y selectores. */
export const LABELS_ES = {
  consent: { UNKNOWN: 'Sin constancia', GRANTED: 'Con consentimiento', REVOKED: 'Dado de baja' } as Record<ConsentStatus, string>,
  consentSource: {
    IMPORT: 'Importación',
    MANUAL: 'Manual',
    WHATSAPP_BUTTON: 'Botón «No recibir más»',
    WHATSAPP_KEYWORD: 'Palabra clave (BAJA/STOP)',
    META_ERROR_131050: 'Meta: el usuario paró el marketing',
    LEGACY_LABEL: 'Etiqueta NO PUBLICIDAD',
    CAMPAIGN_DECLARATION: 'Declaración en campaña',
  } as Record<ConsentSource, string>,
  role: { ADMIN: 'Administradora', AGENT: 'Agente' } as Record<Role, string>,
  campaignStatus: {
    DRAFT: 'Borrador',
    SCHEDULED: 'Programada',
    RUNNING: 'Enviando',
    PAUSED: 'Pausada',
    COMPLETED: 'Completada',
    CANCELLED: 'Cancelada',
    FAILED: 'Fallida',
  } as Record<CampaignStatus, string>,
  templateStatus: {
    LOCAL_DRAFT: 'Borrador',
    PENDING: 'Pendiente',
    APPROVED: 'Aprobada',
    REJECTED: 'Rechazada',
    PAUSED: 'Pausada',
    DISABLED: 'Desactivada',
    IN_APPEAL: 'En apelación',
    DELETED: 'Borrada',
  } as Record<TemplateStatus, string>,
  templateCategory: { MARKETING: 'Marketing', UTILITY: 'Utilidad', AUTHENTICATION: 'Autenticación' } as Record<TemplateCategory, string>,
  skipReason: {
    REVOKED: 'Dado de baja',
    PHONE_INVALID: 'Teléfono inválido',
    DAILY_LIMIT: 'Límite diario de Meta',
    DUPLICATE: 'Duplicado',
    DELETED: 'Contacto borrado',
  } as Record<SkipReason, string>,
};

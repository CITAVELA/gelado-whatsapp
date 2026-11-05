/**
 * Conversión de filas Prisma a los DTO de @gelado/shared (contrato con la web).
 * Las usan inbox (S5), whatsapp/webhooks (S1) para emitir por WebSocket, y contacts (S2).
 */
import { Prisma } from '@prisma/client';
import { metaErrorInfo, WINDOW_MS, type ContactDto, type ConversationEventDto, type ConversationListItemDto, type LabelDto, type MessageDto, type UserMiniDto } from '@gelado/shared';
import { initials } from '../../common/tokens';

export const contactInclude = {
  labels: { include: { label: true } },
  conversation: { select: { id: true, lastMessageAt: true } },
} satisfies Prisma.ContactInclude;
export type ContactRow = Prisma.ContactGetPayload<{ include: typeof contactInclude }>;

export const conversationInclude = {
  contact: { include: { labels: { include: { label: true } } } },
  assignee: { select: { id: true, name: true } },
  labels: { include: { label: true } },
} satisfies Prisma.ConversationInclude;
export type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof conversationInclude }>;

export const messageInclude = {
  media: true,
  sentBy: { select: { id: true, name: true } },
  template: { select: { name: true, components: true } },
  campaign: { select: { name: true } },
} satisfies Prisma.MessageInclude;
export type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export function toLabelDto(l: { id: string; name: string; color: string; scope: any; showAsInboxView: boolean; sortOrder: number }): LabelDto {
  return { id: l.id, name: l.name, color: l.color, scope: l.scope, showAsInboxView: l.showAsInboxView, sortOrder: l.sortOrder };
}

export function toUserMini(u: { id: string; name: string } | null | undefined): UserMiniDto | null {
  return u ? { id: u.id, name: u.name, initials: initials(u.name) } : null;
}

export function contactDisplayName(c: { firstName: string | null; lastName: string | null; profileName: string | null; company?: string | null; phoneE164: string }): string {
  const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return full || c.profileName || c.company || c.phoneE164;
}

export function toContactDto(c: ContactRow): ContactDto {
  return {
    id: c.id,
    phoneE164: c.phoneE164,
    waId: c.waId,
    firstName: c.firstName,
    lastName: c.lastName,
    displayName: contactDisplayName(c),
    profileName: c.profileName,
    email: c.email,
    company: c.company,
    customerCode: c.customerCode,
    taxId: c.taxId,
    landline: c.landline,
    notes: c.notes,
    consentStatus: c.consentStatus,
    consentAt: c.consentAt?.toISOString() ?? null,
    phoneInvalid: c.phoneInvalid,
    labels: c.labels.map((x) => toLabelDto(x.label)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    conversationId: c.conversation?.id ?? null,
    lastActivityAt: c.conversation?.lastMessageAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toConversationListItem(c: ConversationRow, extra: { lastCampaignName?: string | null; searchSnippet?: string | null } = {}): ConversationListItemDto {
  return {
    id: c.id,
    contactId: c.contactId,
    displayName: contactDisplayName(c.contact),
    phoneE164: c.contact.phoneE164,
    status: c.status,
    snoozedUntil: c.snoozedUntil?.toISOString() ?? null,
    assignee: toUserMini(c.assignee),
    starred: c.starred,
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: c.lastMessagePreview,
    lastMessageKind: c.lastMessageKind,
    lastMessageDirection: c.lastMessageDirection,
    windowExpiresAt: c.windowExpiresAt?.toISOString() ?? null,
    contactLabels: c.contact.labels.map((x) => toLabelDto(x.label)),
    conversationLabels: c.labels.map((x) => toLabelDto(x.label)),
    lastCampaignName: extra.lastCampaignName ?? null,
    searchSnippet: extra.searchSnippet ?? null,
  };
}

export function isWindowOpen(windowExpiresAt: Date | null | undefined, now = new Date()) {
  return !!windowExpiresAt && windowExpiresAt.getTime() > now.getTime();
}
export function windowFrom(lastInboundAt: Date) {
  return new Date(lastInboundAt.getTime() + WINDOW_MS);
}

/** Resolver de URL firmada para MediaFile (lo da MediaService). */
export type MediaUrlResolver = (m: { id: string; storagePath: string; fileName: string | null }) => Promise<string | null>;

export async function toMessageDto(
  m: MessageRow,
  resolveUrl: MediaUrlResolver,
  ctx: { quoted?: MessageRow | null; reactions?: Array<{ emoji: string; direction: any; at: Date }> } = {},
): Promise<MessageDto> {
  let payload = (m.payload ?? null) as any;
  // La UI lee los botones de payload.buttons (plantillas: texto de los botones; automáticos: los guardados)
  if (m.kind === 'TEMPLATE' && m.template?.components) {
    const btns = ((m.template.components as any[]).find((c) => c?.type === 'BUTTONS')?.buttons ?? []) as Array<{ text?: string }>;
    if (btns.length) payload = { ...(payload ?? {}), buttons: btns.map((b) => ({ text: b.text ?? '' })) };
  } else if (m.kind === 'AUTO_REPLY' && Array.isArray(payload?.buttons)) {
    payload = { ...payload, buttons: payload.buttons.map((b: any) => ({ text: b?.title ?? b?.text ?? '' })) };
  }
  const info = m.errorCode != null ? metaErrorInfo(m.errorCode) : null;
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    kind: m.kind,
    body: m.body,
    media: m.media
      ? { id: m.media.id, mimeType: m.media.mimeType, sizeBytes: m.media.sizeBytes, fileName: m.media.fileName, url: await resolveUrl(m.media) }
      : payload?.waMediaId
        ? { id: '', mimeType: payload.mimeType ?? 'application/octet-stream', sizeBytes: 0, fileName: payload.fileName ?? null, url: null, pending: true }
        : null,
    templateName: m.template?.name ?? null,
    templateParams: m.templateParams ?? null,
    payload,
    wamid: m.wamid,
    contextWamid: m.contextWamid,
    quoted: ctx.quoted ? { id: ctx.quoted.id, body: ctx.quoted.body, kind: ctx.quoted.kind, direction: ctx.quoted.direction } : null,
    reactions: (ctx.reactions ?? []).map((r) => ({ emoji: r.emoji, direction: r.direction, at: r.at.toISOString() })),
    status: m.status,
    errorCode: m.errorCode,
    errorTitle: m.errorCode != null ? (info?.es ?? m.errorTitle) : m.errorTitle,
    retryable: m.status === 'FAILED' && (m.errorCode == null ? true : !!info?.retryable),
    sentBy: toUserMini(m.sentBy),
    campaignId: m.campaignId,
    campaignName: m.campaign?.name ?? null,
    createdAt: m.createdAt.toISOString(),
    sentAt: m.sentAt?.toISOString() ?? null,
    deliveredAt: m.deliveredAt?.toISOString() ?? null,
    readAt: m.readAt?.toISOString() ?? null,
  };
}

const EVENT_TEXT: Record<string, (actor: string, d: any) => string> = {
  ASSIGNED: (a, d) => (d?.assigneeName ? `${a} asignó a ${d.assigneeName}${d?.auto ? ' (al responder)' : ''}` : `${a} asignó la conversación`),
  UNASSIGNED: (a) => `${a} quitó la asignación`,
  SNOOZED: (a, d) => `${a} pospuso hasta ${d?.untilText ?? (d?.until ? new Date(d.until).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' }) : '')}`,
  WOKE_UP: (_a, d) => (d?.reason === 'inbound' ? 'Volvió a Abiertas: el cliente escribió' : 'Volvió a Abiertas: terminó el tiempo pospuesto'),
  DONE: (a) => `${a} finalizó la conversación`,
  REOPENED: (a, d) => (d?.reason === 'inbound' ? 'Reabierta: el cliente escribió' : `${a} reabrió la conversación`),
  LABEL_ADDED: (a, d) => `${a} añadió la etiqueta ${d?.labelName ?? ''}`,
  LABEL_REMOVED: (a, d) => `${a} quitó la etiqueta ${d?.labelName ?? ''}`,
  STARRED: (a) => `${a} marcó con estrella`,
  UNSTARRED: (a) => `${a} quitó la estrella`,
  CONSENT_CHANGED: (a, d) => (d?.to === 'REVOKED' ? `Contacto dado de baja de las promociones${d?.source ? ` (${d.source})` : ''}` : `${a} cambió el consentimiento a ${d?.to}`),
};

export function toEventDto(e: { id: string; conversationId: string; type: any; data: unknown; createdAt: Date; actor?: { id: string; name: string } | null }): ConversationEventDto {
  const actor = e.actor?.name ?? 'Sistema';
  return {
    id: e.id,
    conversationId: e.conversationId,
    type: e.type,
    actor: toUserMini(e.actor ?? null),
    data: e.data ?? null,
    text: (EVENT_TEXT[e.type] ?? ((a: string) => `${a}: ${e.type}`))(actor, e.data),
    createdAt: e.createdAt.toISOString(),
  };
}

/** Texto corto de vista previa para la lista. */
export function previewFor(kind: string, body: string | null | undefined, extra?: { fileName?: string | null; templateName?: string | null }): string {
  const b = (body ?? '').replace(/\s+/g, ' ').trim();
  switch (kind) {
    case 'TEXT':
    case 'BUTTON_REPLY':
    case 'AUTO_REPLY':
      return b.slice(0, 120);
    case 'IMAGE': return `📷 ${b || 'Foto'}`.slice(0, 120);
    case 'VIDEO': return `🎬 ${b || 'Vídeo'}`.slice(0, 120);
    case 'AUDIO': return '🎵 Audio';
    case 'VOICE': return '🎤 Nota de voz';
    case 'DOCUMENT': return `📄 ${extra?.fileName || b || 'Documento'}`.slice(0, 120);
    case 'STICKER': return 'Sticker';
    case 'LOCATION': return '📍 Ubicación';
    case 'CONTACTS': return '👤 Contacto';
    case 'REACTION': return `Reaccionó ${b}`.trim();
    case 'TEMPLATE': return `📋 ${extra?.templateName ?? 'Plantilla'}${b ? ': ' + b : ''}`.slice(0, 120);
    case 'NOTE': return `Nota: ${b}`.slice(0, 120);
    default: return 'Mensaje no soportado';
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, type Contact, type Conversation, type Message } from '@prisma/client';
import { OPT_OUT_BUTTON_TEXT, OPT_OUT_CONFIRMATION, OPT_OUT_PAYLOAD, WINDOW_MS, isOptOutKeyword, normalizeKeyword, waIdToE164, type WaInboundMessage, type WaStatus } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { DomainEvents } from '../events/domain-events.service';
import { ConsentService } from '../contacts/consent.service';
import { SuppressionService } from '../contacts/suppression.service';
import { JobsService, QUEUES } from '../jobs/jobs.service';
import { previewFor } from '../inbox/mappers';
import { MessageNotifier } from '../whatsapp/message-notifier.service';
import { MessageStatusService } from '../whatsapp/message-status.service';
import { MessagingService } from '../whatsapp/messaging.service';
import { WebhookFieldRouter, type WebhookFieldContext } from './webhook-field-router';

/** Descarga de adjuntos: 5 reintentos con espera (docs/04) */
const MEDIA_RETRY = { retryLimit: 5, retryDelay: 10, retryBackoff: true } as const;

interface Parsed {
  kind: Message['kind'];
  body: string | null;
  payload: Prisma.InputJsonValue | null;
  hasMedia: boolean;
}

/** Traduce un mensaje entrante de Meta a lo que se guarda (tabla de docs/06 · Mensajes entrantes). */
export function parseInbound(m: WaInboundMessage): Parsed {
  const media = (type: 'image' | 'video' | 'document' | 'sticker' | 'audio', kind: Message['kind']): Parsed => {
    const o = (m as any)[type] ?? {};
    return {
      kind,
      body: o.caption ?? null,
      payload: { waMediaId: o.id, mimeType: o.mime_type, fileName: o.filename ?? null, sha256: o.sha256 ?? null, ...(type === 'sticker' ? { animated: !!o.animated } : {}) },
      hasMedia: !!o.id,
    };
  };
  switch (m.type) {
    case 'text':
      return { kind: 'TEXT', body: m.text?.body ?? '', payload: null, hasMedia: false };
    case 'image': return media('image', 'IMAGE');
    case 'video': return media('video', 'VIDEO');
    case 'document': return media('document', 'DOCUMENT');
    case 'sticker': return media('sticker', 'STICKER');
    case 'audio': return media('audio', m.audio?.voice ? 'VOICE' : 'AUDIO');
    case 'location': {
      const l = m.location;
      return {
        kind: 'LOCATION',
        body: [l?.name, l?.address].filter(Boolean).join(' · ') || null,
        payload: { latitude: l?.latitude, longitude: l?.longitude, name: l?.name ?? null, address: l?.address ?? null, mapUrl: `https://www.google.com/maps?q=${l?.latitude},${l?.longitude}` },
        hasMedia: false,
      };
    }
    case 'contacts': {
      const cards = (m.contacts ?? []) as any[];
      const names = cards.map((c) => c?.name?.formatted_name).filter(Boolean).join(', ');
      return { kind: 'CONTACTS', body: names || null, payload: { contacts: cards as Prisma.InputJsonValue }, hasMedia: false };
    }
    case 'button':
      return { kind: 'BUTTON_REPLY', body: m.button?.text ?? '', payload: { text: m.button?.text ?? '', payload: m.button?.payload ?? null }, hasMedia: false };
    case 'interactive': {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
      if (r) return { kind: 'BUTTON_REPLY', body: r.title, payload: { id: r.id, title: r.title, type: m.interactive!.type, ...((r as any).description ? { description: (r as any).description } : {}) }, hasMedia: false };
      return unsupported(m);
    }
    case 'reaction':
      return { kind: 'REACTION', body: m.reaction?.emoji ?? '', payload: { message_id: m.reaction?.message_id ?? null, emoji: m.reaction?.emoji ?? '' }, hasMedia: false };
    default:
      return unsupported(m);
  }
}
function unsupported(m: WaInboundMessage): Parsed {
  return { kind: 'UNSUPPORTED', body: `Tipo de mensaje no soportado: ${m.type}`, payload: { type: m.type }, hasMedia: false };
}

/** ¿Es una petición de baja? Devuelve el origen del consentimiento o null. */
export function optOutSource(m: WaInboundMessage): 'WHATSAPP_BUTTON' | 'WHATSAPP_KEYWORD' | null {
  if (m.type === 'button' && (m.button?.payload === OPT_OUT_PAYLOAD || normalizeKeyword(m.button?.text ?? '') === normalizeKeyword(OPT_OUT_BUTTON_TEXT))) return 'WHATSAPP_BUTTON';
  if (m.type === 'interactive' && (m.interactive?.button_reply?.id === OPT_OUT_PAYLOAD || m.interactive?.list_reply?.id === OPT_OUT_PAYLOAD)) return 'WHATSAPP_BUTTON';
  if (m.type === 'text' && isOptOutKeyword(m.text?.body)) return 'WHATSAPP_KEYWORD';
  return null;
}

/** Procesa el campo `messages` del webhook: mensajes entrantes y estados de los salientes. */
@Injectable()
export class InboundMessagesService implements OnModuleInit {
  private readonly log = new Logger('Inbound');
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: WebhookFieldRouter,
    private readonly events: DomainEvents,
    private readonly consent: ConsentService,
    private readonly jobs: JobsService,
    private readonly notifier: MessageNotifier,
    private readonly statusSvc: MessageStatusService,
    private readonly messaging: MessagingService,
    private readonly suppression: SuppressionService,
  ) {}

  onModuleInit() {
    this.router.on('messages', 'whatsapp', (value, ctx) => this.handle(value, ctx));
  }

  async handle(value: any, _ctx?: WebhookFieldContext) {
    for (const m of (value?.messages ?? []) as WaInboundMessage[]) {
      const profile = (value.contacts ?? []).find((c: any) => c?.wa_id === m.from)?.profile?.name ?? null;
      await this.handleMessage(m, profile);
    }
    for (const s of (value?.statuses ?? []) as WaStatus[]) await this.handleStatus(s);
  }

  // ───────────────────────── Estados ─────────────────────────

  /** Lanza si el mensaje aún no existe (el estado llegó antes que la respuesta del envío): el job se reintenta. */
  private async handleStatus(s: WaStatus) {
    await this.statusSvc.applyWebhookStatus(s);
  }

  // ───────────────────────── Entrantes ─────────────────────────

  async handleMessage(m: WaInboundMessage, profileName: string | null) {
    const duplicate = await this.prisma.message.findUnique({ where: { wamid: m.id }, include: { conversation: true } });
    if (duplicate) {
      // Webhook repetido: no se duplica. Solo se asegura que una baja pendiente quede aplicada.
      const src = optOutSource(m);
      if (src) await this.applyOptOut(duplicate.conversation.contactId, duplicate.conversationId, duplicate.id, src, true);
      return;
    }

    const parsed = parseInbound(m);
    const ts = new Date(Number(m.timestamp) * 1000);
    const at = Number.isNaN(ts.getTime()) ? new Date() : ts;

    let created: { message: Message; contact: Contact; conversation: Conversation; prevStatus: string; eventIds: string[] } | null = null;
    for (let attempt = 0; attempt < 2 && !created; attempt++) {
      try {
        created = await this.store(m, parsed, profileName, at);
      } catch (e) {
        // Carrera entre dos webhooks simultáneos (contacto, conversación o wamid duplicados): se repite una vez
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          if (await this.prisma.message.findUnique({ where: { wamid: m.id }, select: { id: true } })) return;
          continue;
        }
        throw e;
      }
    }
    if (!created) throw new Error(`No se pudo guardar el mensaje ${m.id}`);
    const { message, contact, conversation, prevStatus, eventIds } = created;
    const reopened = prevStatus === 'DONE' || prevStatus === 'SNOOZED';
    // Lista de supresión (derecho de supresión ejercido antes): si el número vuelve a escribir, nace dado de baja
    if (contact.consentStatus !== 'REVOKED') await this.suppression.enforce(contact.id, contact.phoneE164);

    // Tiempo real
    await this.notifier.created(message.id, parsed.kind !== 'REACTION');
    await this.notifier.conversation(conversation.id);
    for (const id of eventIds) await this.notifier.event(id);

    // Adjunto: descargar ya (la URL de Meta caduca en minutos)
    if (parsed.hasMedia) await this.jobs.send(QUEUES.WA_MEDIA_DOWNLOAD, { messageId: message.id }, MEDIA_RETRY).catch((e) => this.log.error(`No se pudo encolar la descarga de ${message.id}: ${e}`));

    // Baja
    const src = optOutSource(m);
    let optedOut = false;
    if (src) optedOut = await this.applyOptOut(contact.id, conversation.id, message.id, src, false);

    await this.events.emit('inbound.message', {
      conversationId: conversation.id,
      contactId: contact.id,
      messageId: message.id,
      kind: parsed.kind,
      text: parsed.kind === 'TEXT' || parsed.kind === 'BUTTON_REPLY' ? parsed.body : null,
      buttonPayload: m.type === 'button' ? (m.button?.payload ?? null) : m.type === 'interactive' ? (m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? null) : null,
      at,
      optedOut,
      reopened,
    });
  }

  /** Contacto + conversación + mensaje en una transacción. */
  private async store(m: WaInboundMessage, parsed: Parsed, profileName: string | null, at: Date) {
    return this.prisma.$transaction(async (tx) => {
      const phoneE164 = waIdToE164(m.from);
      let contact = await tx.contact.findFirst({ where: { OR: [{ waId: m.from }, { phoneE164 }] } });
      if (!contact) {
        contact = await tx.contact.create({ data: { phoneE164, waId: m.from, profileName } });
      } else {
        const data: Prisma.ContactUpdateInput = {};
        if (!contact.waId) data.waId = m.from;
        if (profileName && profileName !== contact.profileName) data.profileName = profileName; // sin tocar firstName
        if (contact.deletedAt) data.deletedAt = null; // si vuelve a escribir, reaparece
        if (Object.keys(data).length) contact = await tx.contact.update({ where: { id: contact.id }, data });
      }

      // Se bloquea la fila de la conversación antes de leer su estado: si alguien la pospone o finaliza a la vez,
      // o su cambio se ve ya aquí (y se reabre) o espera a que este mensaje quede guardado (S9 #20). Sin el bloqueo,
      // se leía «abierta», se escribía el mensaje y quedaba pospuesta/finalizada con un no leído escondido.
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE "contactId" = ${contact.id}::uuid FOR UPDATE`;
      let conv = await tx.conversation.findUnique({ where: { contactId: contact.id } });
      if (!conv) conv = await tx.conversation.create({ data: { contactId: contact.id } });
      const prevStatus = conv.status;
      const isReaction = parsed.kind === 'REACTION';

      const message = await tx.message.create({
        data: {
          conversationId: conv.id,
          direction: 'INBOUND',
          kind: parsed.kind,
          body: parsed.body,
          payload: parsed.payload ?? Prisma.DbNull,
          wamid: m.id,
          contextWamid: m.context?.id ?? null,
          status: 'RECEIVED',
          receivedAt: at,
          raw: m as unknown as Prisma.InputJsonValue,
        },
      });

      const lastInboundAt = conv.lastInboundAt && conv.lastInboundAt > at ? conv.lastInboundAt : at;
      const data: Prisma.ConversationUpdateInput = {
        lastInboundAt,
        windowExpiresAt: new Date(lastInboundAt.getTime() + WINDOW_MS),
        lastMessageAt: at,
        lastMessagePreview: previewFor(parsed.kind, parsed.body, { fileName: (parsed.payload as any)?.fileName }),
        lastMessageKind: parsed.kind,
        lastMessageDirection: 'INBOUND',
        ...(isReaction ? {} : { unreadCount: { increment: 1 } }),
      };
      const eventIds: string[] = [];
      if (!isReaction && prevStatus === 'DONE') {
        data.status = 'OPEN';
        eventIds.push((await tx.conversationEvent.create({ data: { conversationId: conv.id, type: 'REOPENED', data: { reason: 'inbound' } } })).id);
      } else if (!isReaction && prevStatus === 'SNOOZED') {
        data.status = 'OPEN';
        data.snoozedUntil = null;
        eventIds.push((await tx.conversationEvent.create({ data: { conversationId: conv.id, type: 'WOKE_UP', data: { reason: 'inbound' } } })).id);
      }
      conv = await tx.conversation.update({ where: { id: conv.id }, data });
      return { message, contact, conversation: conv, prevStatus: isReaction ? 'OPEN' : prevStatus, eventIds };
    });
  }

  /** Baja: ConsentService (única puerta) + confirmación automática. Devuelve si la baja quedó aplicada. */
  private async applyOptOut(contactId: string, conversationId: string, messageId: string, source: 'WHATSAPP_BUTTON' | 'WHATSAPP_KEYWORD', isReplay: boolean): Promise<boolean> {
    const before = await this.prisma.contact.findUnique({ where: { id: contactId }, select: { consentStatus: true } });
    // En un reintento, si la baja ya estaba aplicada no se repite ni se reenvía la confirmación
    if (isReplay && before?.consentStatus === 'REVOKED') return true;
    await this.consent.setConsent(contactId, 'REVOKED', source, { messageId });
    try {
      await this.messaging.sendAutoReply(conversationId, OPT_OUT_CONFIRMATION);
    } catch (e) {
      this.log.error(`No se pudo enviar la confirmación de baja a ${contactId}: ${(e as Error).message}`);
    }
    return true;
  }
}

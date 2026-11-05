import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, type Message } from '@prisma/client';
import {
  OPT_OUT_PAYLOAD,
  extractVariables,
  metaErrorInfo,
  optOutButtonIndex,
  renderTemplateText,
  templateVariableKeys,
  validateMediaForWhatsApp,
  type TemplateComponent,
  type WaOutboundMessage,
  type WaTemplateSendComponent,
} from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { JobsService, QUEUES } from '../jobs/jobs.service';
import { MediaService } from '../media/media.service';
import { isWindowOpen, previewFor } from '../inbox/mappers';
import { WhatsAppApiError, WhatsAppGateway } from './whatsapp.gateway';
import { MessageNotifier } from './message-notifier.service';
import { MessageStatusService } from './message-status.service';

export const WINDOW_CLOSED_MESSAGE = 'La ventana de 24 h está cerrada: solo puedes enviar una plantilla';
/** 1 intento + 3 reintentos (docs/04) */
const MAX_SEND_ATTEMPTS = 4;

type ConversationWithContact = Prisma.ConversationGetPayload<{ include: { contact: true } }>;

interface OutboundData {
  kind: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO' | 'VOICE' | 'TEMPLATE' | 'AUTO_REPLY';
  body?: string | null;
  mediaId?: string | null;
  templateId?: string | null;
  templateParams?: Record<string, string> | null;
  payload?: Prisma.InputJsonValue | null;
  contextWamid?: string | null;
  sentById?: string | null;
  campaignId?: string | null;
  sentOutsideWindow?: boolean;
}

/**
 * Envío de mensajes salientes (docs/06 · Envío). Crea el `Message` PENDING, actualiza la conversación,
 * avisa por WebSocket y encola `wa-send`; el worker llama a la Graph API y guarda el wamid.
 * Las notas internas NO pasan por aquí.
 */
@Injectable()
export class MessagingService implements OnModuleInit {
  private readonly log = new Logger('Messaging');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly gateway: WhatsAppGateway,
    private readonly media: MediaService,
    private readonly notifier: MessageNotifier,
    private readonly statusSvc: MessageStatusService,
  ) {}

  onModuleInit() {
    this.jobs.register<{ messageId: string }>(QUEUES.WA_SEND, (d) => this.processSend(d.messageId));
  }

  // ───────────────────────── API pública ─────────────────────────

  /** Texto libre (solo con la ventana de 24 h abierta). */
  async sendText(conversationId: string, body: string, opts: { userId?: string | null; replyToMessageId?: string | null } = {}): Promise<Message> {
    const text = body.trim();
    if (!text) throw new BadRequestException({ statusCode: 400, message: 'El mensaje está vacío' });
    if (text.length > 4096) throw new BadRequestException({ statusCode: 400, message: 'El mensaje supera los 4.096 caracteres' });
    const conv = await this.loadConversation(conversationId);
    this.assertWindowOpen(conv);
    const contextWamid = await this.contextFor(conversationId, opts.replyToMessageId);
    return this.createOutbound(conv, { kind: 'TEXT', body: text, contextWamid, sentById: opts.userId });
  }

  /** Adjuntos ya subidos (POST /api/media o biblioteca): un mensaje por archivo, el pie en el primero. */
  async sendMedia(conversationId: string, mediaFileIds: string[], opts: { caption?: string | null; voice?: boolean; userId?: string | null } = {}): Promise<Message[]> {
    if (!mediaFileIds.length) throw new BadRequestException({ statusCode: 400, message: 'No hay archivos que enviar' });
    const conv = await this.loadConversation(conversationId);
    this.assertWindowOpen(conv);

    // Validar todo antes de crear ningún mensaje
    const prepared: Array<{ file: Awaited<ReturnType<MediaService['get']>>; kind: OutboundData['kind'] }> = [];
    for (let file of await Promise.all(mediaFileIds.map((id) => this.media.get(id)))) {
      const check = validateMediaForWhatsApp(file.mimeType, file.sizeBytes);
      if (!check.ok) throw new BadRequestException({ statusCode: 400, message: check.reason });
      let kind: OutboundData['kind'] = check.type === 'image' ? 'IMAGE' : check.type === 'video' ? 'VIDEO' : check.type === 'document' ? 'DOCUMENT' : 'AUDIO';
      if (check.type === 'audio') {
        // Notas de voz y audio del navegador (webm) → OGG/Opus mono
        if (opts.voice || /webm|opus/.test(file.mimeType)) file = await this.media.convertVoice(file.id, opts.userId);
        if (opts.voice) kind = 'VOICE';
      }
      prepared.push({ file, kind });
    }

    const caption = opts.caption?.trim() || null;
    const out: Message[] = [];
    let captionUsed = false;
    for (const { file, kind } of prepared) {
      const captionable = kind === 'IMAGE' || kind === 'VIDEO' || kind === 'DOCUMENT';
      const useCaption = !!caption && !captionUsed && captionable;
      if (useCaption) captionUsed = true;
      out.push(await this.createOutbound(conv, { kind, body: useCaption ? caption : null, mediaId: file.id, sentById: opts.userId }, { fileName: file.fileName }));
    }
    // Pie que no cabe en un audio: va como texto aparte
    if (caption && !captionUsed) out.push(await this.createOutbound(conv, { kind: 'TEXT', body: caption, sentById: opts.userId }));
    return out;
  }

  /**
   * Plantilla (puede enviarse con la ventana cerrada). `params` usa las claves de `templateVariableKeys`
   * («header.1», «body.1», «button.0»). Añade siempre el payload OPT_OUT al botón de baja.
   */
  async sendTemplate(
    conversationId: string,
    templateId: string,
    params: Record<string, string>,
    opts: { headerMediaFileId?: string | null; userId?: string | null; campaignId?: string | null } = {},
  ): Promise<Message> {
    const conv = await this.loadConversation(conversationId);
    const template = await this.prisma.template.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException({ statusCode: 404, message: 'Plantilla no encontrada' });
    if (template.status !== 'APPROVED') {
      throw new ConflictException({ statusCode: 409, message: 'La plantilla no está aprobada por Meta, no se puede enviar' });
    }
    // Regla 5: quien se dio de baja nunca recibe marketing
    if (template.category === 'MARKETING' && conv.contact.consentStatus === 'REVOKED') {
      throw new ConflictException({ statusCode: 409, message: 'El contacto se ha dado de baja de las promociones: no se le puede enviar una plantilla de marketing' });
    }
    const comps = template.components as unknown as TemplateComponent[];
    const clean = Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, cleanParam(String(v ?? ''))]));
    const missing = templateVariableKeys(comps).filter((k) => !clean[k]);
    if (missing.length) throw new BadRequestException({ statusCode: 400, message: `Faltan variables de la plantilla: ${missing.join(', ')}` });
    const header = comps.find((c) => c.type === 'HEADER');
    const needsMedia = !!header && (header.format === 'IMAGE' || header.format === 'VIDEO' || header.format === 'DOCUMENT');
    if (needsMedia && !opts.headerMediaFileId) throw new BadRequestException({ statusCode: 400, message: 'La plantilla necesita un archivo para la cabecera' });
    if (needsMedia) {
      const f = await this.media.get(opts.headerMediaFileId!);
      const check = validateMediaForWhatsApp(f.mimeType, f.sizeBytes);
      if (!check.ok) throw new BadRequestException({ statusCode: 400, message: check.reason });
    }

    const bodyText = comps.find((c) => c.type === 'BODY')?.text;
    const values: Record<number, string> = {};
    for (const n of extractVariables(bodyText)) values[n] = clean[`body.${n}`] ?? '';
    const rendered = renderTemplateText(bodyText, values);

    return this.createOutbound(
      conv,
      {
        kind: 'TEMPLATE',
        body: rendered,
        templateId: template.id,
        templateParams: clean,
        mediaId: needsMedia ? opts.headerMediaFileId : null,
        sentById: opts.userId,
        campaignId: opts.campaignId,
        sentOutsideWindow: !isWindowOpen(conv.windowExpiresAt),
      },
      { templateName: template.displayName ?? template.name },
    );
  }

  /** Mensaje interactivo con hasta 3 botones de respuesta (respuesta fuera de horario). Títulos ≤ 20. */
  async sendInteractiveButtons(
    conversationId: string,
    text: string,
    buttons: Array<{ id: string; title: string }>,
    _opts: { kind: 'AUTO_REPLY' } = { kind: 'AUTO_REPLY' },
  ): Promise<Message> {
    if (!buttons.length || buttons.length > 3) throw new BadRequestException({ statusCode: 400, message: 'Un mensaje interactivo lleva de 1 a 3 botones' });
    const conv = await this.loadConversation(conversationId);
    this.assertWindowOpen(conv);
    const btns = buttons.map((b) => ({ id: b.id.slice(0, 256), title: b.title.slice(0, 20) }));
    return this.createOutbound(conv, { kind: 'AUTO_REPLY', body: text, payload: { buttons: btns } });
  }

  /** Mensaje automático de texto dentro de la ventana (p. ej. confirmación de baja). */
  async sendAutoReply(conversationId: string, text: string): Promise<Message> {
    const conv = await this.loadConversation(conversationId);
    this.assertWindowOpen(conv);
    return this.createOutbound(conv, { kind: 'AUTO_REPLY', body: text });
  }

  /** Marca como leído en WhatsApp el último mensaje entrante (RF-2.22). Devuelve false si no había nada que marcar o falló. */
  async markConversationRead(conversationId: string): Promise<boolean> {
    const last = await this.prisma.message.findFirst({
      where: { conversationId, direction: 'INBOUND', wamid: { not: null }, kind: { not: 'REACTION' } },
      orderBy: { createdAt: 'desc' },
      select: { wamid: true },
    });
    if (!last?.wamid) return false;
    try {
      await this.gateway.markRead(last.wamid);
      return true;
    } catch (e) {
      this.log.warn(`No se pudo marcar como leído ${last.wamid}: ${(e as Error).message}`);
      return false;
    }
  }

  /** Reenvía un mensaje fallido por un error temporal. */
  async retry(messageId: string, userId?: string | null): Promise<Message> {
    const m = await this.prisma.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { contact: true } } } });
    if (!m || m.direction !== 'OUTBOUND') throw new NotFoundException({ statusCode: 404, message: 'Mensaje no encontrado' });
    const info = m.errorCode != null ? metaErrorInfo(m.errorCode) : null;
    if (m.status !== 'FAILED' || (info && !info.retryable)) {
      throw new ConflictException({ statusCode: 409, message: 'Este mensaje no se puede reintentar' });
    }
    if (m.kind !== 'TEMPLATE') this.assertWindowOpen(m.conversation);
    const upd = await this.prisma.message.update({
      where: { id: m.id },
      data: { status: 'PENDING', wamid: null, errorCode: null, errorTitle: null, errorDetails: null, failedAt: null, raw: Prisma.DbNull, ...(userId ? { sentById: userId } : {}) },
    });
    this.notifier.status(upd);
    await this.jobs.send(QUEUES.WA_SEND, { messageId: m.id });
    return (await this.prisma.message.findUnique({ where: { id: m.id } })) ?? upd;
  }

  /** Crea la conversación del contacto si no existe (campañas, pruebas, «nueva conversación»). */
  async ensureConversationForContact(contactId: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) throw new NotFoundException({ statusCode: 404, message: 'Contacto no encontrado' });
    const existing = await this.prisma.conversation.findUnique({ where: { contactId } });
    if (existing) return existing;
    try {
      return await this.prisma.conversation.create({ data: { contactId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return this.prisma.conversation.findUniqueOrThrow({ where: { contactId } });
      throw e;
    }
  }

  // ───────────────────────── Internos ─────────────────────────

  private async loadConversation(id: string): Promise<ConversationWithContact> {
    const c = await this.prisma.conversation.findUnique({ where: { id }, include: { contact: true } });
    if (!c) throw new NotFoundException({ statusCode: 404, message: 'Conversación no encontrada' });
    return c;
  }

  private assertWindowOpen(c: { windowExpiresAt: Date | null }) {
    if (!isWindowOpen(c.windowExpiresAt)) throw new ConflictException({ statusCode: 409, message: WINDOW_CLOSED_MESSAGE });
  }

  private async contextFor(conversationId: string, replyToMessageId?: string | null): Promise<string | null> {
    if (!replyToMessageId) return null;
    const q = await this.prisma.message.findFirst({ where: { id: replyToMessageId, conversationId }, select: { wamid: true } });
    return q?.wamid ?? null;
  }

  private async createOutbound(conv: ConversationWithContact, d: OutboundData, previewExtra: { fileName?: string | null; templateName?: string | null } = {}): Promise<Message> {
    const now = new Date();
    const message = await this.prisma.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: {
          conversationId: conv.id,
          direction: 'OUTBOUND',
          kind: d.kind,
          body: d.body ?? null,
          mediaId: d.mediaId ?? null,
          templateId: d.templateId ?? null,
          templateParams: d.templateParams ?? Prisma.DbNull,
          payload: d.payload ?? Prisma.DbNull,
          contextWamid: d.contextWamid ?? null,
          status: 'PENDING',
          sentOutsideWindow: d.sentOutsideWindow ?? false,
          sentById: d.sentById ?? null,
          campaignId: d.campaignId ?? null,
        },
      });
      await tx.conversation.update({
        where: { id: conv.id },
        data: {
          lastMessageAt: now,
          lastMessagePreview: previewFor(d.kind, d.body, previewExtra),
          lastMessageKind: d.kind,
          lastMessageDirection: 'OUTBOUND',
          ...(d.campaignId ? { lastCampaignId: d.campaignId } : {}),
        },
      });
      return m;
    });
    await this.notifier.created(message.id, false);
    await this.notifier.conversation(conv.id);
    await this.jobs.send(QUEUES.WA_SEND, { messageId: message.id });
    // En modo inline el envío ya se ha hecho: devolver el estado actual
    return (await this.prisma.message.findUnique({ where: { id: message.id } })) ?? message;
  }

  /** Worker de `wa-send`: llama a la Graph API. Errores temporales → relanza (pg-boss reintenta); definitivos → FAILED. */
  async processSend(messageId: string): Promise<void> {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { template: true, media: true, conversation: { include: { contact: true } } },
    });
    if (!msg || msg.direction !== 'OUTBOUND' || msg.status !== 'PENDING' || msg.wamid) return; // ya enviado o cancelado: idempotente

    try {
      const wa = await this.buildOutbound(msg);
      const to = msg.conversation.contact.waId ?? msg.conversation.contact.phoneE164;
      const res = await this.gateway.sendMessage(to, wa, { contextWamid: msg.contextWamid ?? undefined });
      const wamid = res.messages?.[0]?.id;
      if (!wamid) throw new WhatsAppApiError(undefined, null, metaErrorInfo(null, 502));
      await this.statusSvc.markSent(msg.id, wamid);
    } catch (e) {
      const err = e instanceof WhatsAppApiError ? e : new WhatsAppApiError(undefined, null, metaErrorInfo(null, 500));
      if (!(e instanceof WhatsAppApiError)) this.log.error(`Fallo al preparar el envío ${msg.id}: ${(e as Error)?.stack ?? e}`);
      const attempts = (((msg.raw as any)?.sendAttempts as number | undefined) ?? 0) + 1;
      if (err.retryable && attempts < MAX_SEND_ATTEMPTS) {
        await this.prisma.message.update({ where: { id: msg.id }, data: { raw: { sendAttempts: attempts, lastError: err.message } } });
        throw err; // pg-boss reintenta con espera
      }
      await this.statusSvc.markFailed(msg.id, { code: err.info.code || null, title: err.info.es, details: err.graph?.message ?? err.message });
    }
  }

  private async buildOutbound(msg: Prisma.MessageGetPayload<{ include: { template: true; media: true } }>): Promise<WaOutboundMessage> {
    const mediaOut = async (type: 'image' | 'video' | 'audio' | 'document'): Promise<WaOutboundMessage> => {
      if (!msg.mediaId) throw new Error('Mensaje sin archivo');
      const id = await this.media.ensureWaMediaId(msg.mediaId);
      const caption = msg.body || undefined;
      if (type === 'audio') return { type: 'audio', audio: { id } };
      if (type === 'document') return { type: 'document', document: { id, caption, filename: msg.media?.fileName ?? undefined } };
      return { type, [type]: { id, caption } } as WaOutboundMessage;
    };
    switch (msg.kind) {
      case 'IMAGE': return mediaOut('image');
      case 'VIDEO': return mediaOut('video');
      case 'DOCUMENT': return mediaOut('document');
      case 'AUDIO':
      case 'VOICE': return mediaOut('audio');
      case 'TEMPLATE': return this.buildTemplate(msg);
      case 'AUTO_REPLY': {
        const buttons = (msg.payload as any)?.buttons as Array<{ id: string; title: string }> | undefined;
        if (buttons?.length) {
          return { type: 'interactive', interactive: { type: 'button', body: { text: msg.body ?? '' }, action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) } } };
        }
        return { type: 'text', text: { body: msg.body ?? '', preview_url: false } };
      }
      default: return { type: 'text', text: { body: msg.body ?? '', preview_url: true } };
    }
  }

  private async buildTemplate(msg: Prisma.MessageGetPayload<{ include: { template: true; media: true } }>): Promise<WaOutboundMessage> {
    const t = msg.template;
    if (!t) throw new Error('Mensaje de plantilla sin plantilla');
    const comps = t.components as unknown as TemplateComponent[];
    const params = (msg.templateParams ?? {}) as Record<string, string>;
    const out: WaTemplateSendComponent[] = [];

    const header = comps.find((c) => c.type === 'HEADER');
    if (header?.format === 'TEXT') {
      const vars = [...new Set(extractVariables(header.text))].sort((a, b) => a - b);
      if (vars.length) out.push({ type: 'header', parameters: vars.map((n) => ({ type: 'text' as const, text: params[`header.${n}`] ?? '' })) });
    } else if (header && msg.mediaId && (header.format === 'IMAGE' || header.format === 'VIDEO' || header.format === 'DOCUMENT')) {
      const id = await this.media.ensureWaMediaId(msg.mediaId);
      const p = header.format === 'IMAGE' ? { type: 'image' as const, image: { id } } : header.format === 'VIDEO' ? { type: 'video' as const, video: { id } } : { type: 'document' as const, document: { id, filename: msg.media?.fileName ?? undefined } };
      out.push({ type: 'header', parameters: [p] });
    }

    const body = comps.find((c) => c.type === 'BODY');
    const bodyVars = [...new Set(extractVariables(body?.text))].sort((a, b) => a - b);
    if (bodyVars.length) out.push({ type: 'body', parameters: bodyVars.map((n) => ({ type: 'text' as const, text: params[`body.${n}`] ?? '' })) });

    comps.find((c) => c.type === 'BUTTONS')?.buttons?.forEach((b, i) => {
      if (b.type === 'URL' && b.url && /\{\{\s*1\s*\}\}/.test(b.url)) {
        out.push({ type: 'button', sub_type: 'url', index: String(i), parameters: [{ type: 'text', text: params[`button.${i}`] ?? '' }] });
      }
    });
    // Botón «No recibir más»: el payload OPT_OUT vuelve en la respuesta del cliente (docs/06)
    const optIdx = optOutButtonIndex(comps);
    if (optIdx >= 0) out.push({ type: 'button', sub_type: 'quick_reply', index: String(optIdx), parameters: [{ type: 'payload', payload: OPT_OUT_PAYLOAD }] });

    return { type: 'template', template: { name: t.name, language: { code: t.language }, ...(out.length ? { components: out } : {}) } };
  }
}

/** Meta rechaza saltos de línea, tabuladores y más de 4 espacios seguidos en los parámetros de plantilla. */
function cleanParam(v: string): string {
  return v.replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
}

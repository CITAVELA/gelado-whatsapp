// Implementación en memoria de InboxApi con datos de ejemplo (VITE_INBOX_MOCK=1) y para las pruebas.
// No tiene efectos al importarla: el estado se crea al primer uso.
import {
  templateVariableKeys,
  renderTemplateText,
  extractVariables,
  type ConversationDetailDto,
  type ConversationEventDto,
  type ConversationListItemDto,
  type ConversationStatus,
  type ContactDto,
  type CursorPage,
  type InboxCountsDto,
  type InboxView,
  type LabelDto,
  type LibraryFileDto,
  type LibraryFolderDto,
  type MediaDto,
  type MessageDto,
  type MessageKind,
  type Rates,
  type SendMessageDto,
  type ServerToClientEvents,
  type TemplateComponent,
  type TemplateDto,
  type TimelineItemDto,
  type UserMiniDto,
} from '@gelado/shared';
import { HttpError } from '../../lib/api';
import { snoozeOptions } from './utils';
import type { InboxApi, ListParams } from './api';

// ── Bus de eventos (sustituye al socket en modo simulado) ──
type Handler = (payload: any) => void;
const bus = new Map<string, Set<Handler>>();
export const mockBus = {
  on(event: keyof ServerToClientEvents, fn: Handler) {
    if (!bus.has(event)) bus.set(event, new Set());
    bus.get(event)!.add(fn);
    return () => bus.get(event)?.delete(fn);
  },
  emit(event: keyof ServerToClientEvents, payload: unknown) {
    bus.get(event)?.forEach((fn) => fn(payload));
  },
};

// ── Imágenes de ejemplo (SVG en data URI) ──
function svg(label: string, w: number, h: number, a: string, b: string) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><text x="50%" y="50%" fill="#fff" font-family="Arial" font-size="${Math.round(h / 9)}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
}
function wavUri(seconds = 4) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = new Uint8Array(44 + n);
  const dv = new DataView(buf.buffer);
  const str = (o: number, t: string) => [...t].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate, true);
  dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); str(36, 'data'); dv.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(Math.sin(i / 14) * 18 * (1 - (i % 4000) / 4000));
  let bin = '';
  buf.forEach((c) => (bin += String.fromCharCode(c)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}
const PDF_URI = `data:application/pdf;base64,${btoa('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')}`;

// ── Datos base ──
export const ME: UserMiniDto = { id: 'u-maria', name: 'María Iborra', initials: 'MI' };
const CRIS: UserMiniDto = { id: 'u-cris', name: 'Cristina Lopez', initials: 'CL' };
const LOLO: UserMiniDto = { id: 'u-lolo', name: 'Lolo Gelado', initials: 'LG' };
const USERS = [ME, CRIS, LOLO];

const L = (id: string, name: string, color: string, scope: 'CONTACT' | 'CONVERSATION', sortOrder: number): LabelDto => ({ id, name, color, scope, showAsInboxView: true, sortOrder });
export const LABELS: LabelDto[] = [
  L('l-pel', 'PELUQUERÍA', '#2457C5', 'CONTACT', 1),
  L('l-bar', 'BARBERÍA', '#C2333A', 'CONTACT', 2),
  L('l-est', 'ESTÉTICA', '#1E7A3D', 'CONTACT', 3),
  L('l-ins', 'INSTITUTO', '#B08A00', 'CONTACT', 4),
  L('l-jub', 'JUBILADO', '#6B737C', 'CONTACT', 5),
  L('t-ped', 'PEDIDO', '#1F5E33', 'CONVERSATION', 1),
  L('t-fac', 'FACTURA', '#C46A00', 'CONVERSATION', 2),
  L('t-tra', 'TRANSPORTE', '#3B33A6', 'CONVERSATION', 3),
];
const lab = (id: string) => LABELS.find((l) => l.id === id)!;

const RATES: Rates = { currency: 'EUR', marketing: 0.0585, utility: 0.0248, authentication: 0.0275, service: 0, freeServicePerMonth: 1000 };

function tpl(id: string, name: string, displayName: string, category: 'MARKETING' | 'UTILITY', header: 'NONE' | 'DOCUMENT' | 'IMAGE', body: string, buttons: string[], examples: string[] = []): TemplateDto {
  const components: TemplateComponent[] = [];
  if (header !== 'NONE') components.push({ type: 'HEADER', format: header });
  components.push({ type: 'BODY', text: body, example: examples.length ? { body_text: [examples] } : undefined });
  components.push({ type: 'FOOTER', text: 'Exclusivas Gelado' });
  if (buttons.length) components.push({ type: 'BUTTONS', buttons: buttons.map((text) => ({ type: 'QUICK_REPLY' as const, text })) });
  return {
    id, metaTemplateId: `meta-${id}`, name, displayName, language: 'es', category, status: 'APPROVED', components, rejectedReason: null,
    qualityScore: 'GREEN', hasOptOutButton: buttons.some((b) => /no recibir/i.test(b)), variables: templateVariableKeys(components),
    headerFormat: header, usableInCampaigns: true, lastSyncedAt: null, updatedAt: new Date().toISOString(),
  };
}
const OPT = 'No recibir más';
const TEMPLATES: TemplateDto[] = [
  tpl('tp-1', 'inicio_conversacion', 'Inicio de Conversación', 'MARKETING', 'NONE', 'Hola {{1}}, te escribimos de Exclusivas Gelado. ¿Podemos ayudarte con tu próximo pedido? {{2}}\n\nUn saludo, Gelado.', ['Sí, quiero hacer un pedido', OPT], ['Sonia', 'Tenemos novedades en tintes.']),
  tpl('tp-2', 'buenos_dias', 'Buenos días', 'MARKETING', 'NONE', 'Buenos días {{1}}, ¿necesitas algo de Exclusivas Gelado hoy?', [OPT], ['Marisol']),
  tpl('tp-3', 'buenas_tardes', 'Buenas Tardes', 'MARKETING', 'NONE', 'Buenas tardes {{1}}, seguimos a tu disposición para lo que necesites.', [OPT], ['Marisol']),
  tpl('tp-4', 'mandar_pdf', 'Mandar PDF', 'MARKETING', 'DOCUMENT', 'Hola {{1}}, te enviamos el catálogo actualizado.', [OPT], ['Marisol']),
  tpl('tp-5', 'aviso_pedido_enviado', 'Aviso de pedido enviado', 'UTILITY', 'NONE', 'Hola {{1}}, tu pedido {{2}} ha salido hoy en la ruta.', [], ['Marisol', 'A-2026-1187']),
];

// ── Fábrica ──
let seq = 1;
const nid = (p: string) => `${p}-${seq++}`;
const mediaOf = (kind: 'img' | 'pdf' | 'audio', name: string, extra: Partial<MediaDto> = {}): MediaDto => {
  const id = nid('media');
  if (kind === 'img') return { id, mimeType: 'image/svg+xml', sizeBytes: 184_000, fileName: name, url: svg(name, 640, 400, '#4F6D8F', '#1F3347'), ...extra };
  if (kind === 'audio') return { id, mimeType: 'audio/wav', sizeBytes: 38_000, fileName: name, url: wavUri(), ...extra };
  return { id, mimeType: 'application/pdf', sizeBytes: 2_400_000, fileName: name, url: PDF_URI, ...extra };
};

export interface MockOptions { delay?: number }

export function createMockApi(opts: MockOptions = {}): InboxApi & { _reset(): void; simulateIncoming(conversationId?: string, text?: string): void } {
  const delay = opts.delay ?? 120;
  const wait = <T,>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(structuredClone(v)), delay));
  const now = () => Date.now();
  const iso = (msAgo: number) => new Date(now() - msAgo).toISOString();
  const min = 60_000;
  const hour = 3600_000;

  type Conv = ConversationDetailDto;
  let convs: Conv[] = [];
  let msgs: Record<string, MessageDto[]> = {};
  let evts: Record<string, ConversationEventDto[]> = {};
  let folders: LibraryFolderDto[] = [];
  let files: LibraryFileDto[] = [];

  function m(conversationId: string, p: Partial<MessageDto> & { direction: MessageDto['direction']; kind: MessageKind; at: number }): MessageDto {
    const t = iso(p.at);
    const out = p.direction !== 'INBOUND';
    const base: MessageDto = {
      id: nid('m'), conversationId, direction: p.direction, kind: p.kind, body: null, media: null, templateName: null, templateParams: null,
      payload: null, wamid: nid('wamid'), contextWamid: null, quoted: null, reactions: [], status: out ? 'READ' : 'RECEIVED', errorCode: null,
      errorTitle: null, retryable: false, sentBy: null, campaignId: null, campaignName: null, createdAt: t, sentAt: out ? t : null,
      deliveredAt: out ? t : null, readAt: out ? t : null,
    };
    const { at: _at, ...rest } = p;
    return { ...base, ...rest };
  }
  function ev(conversationId: string, type: ConversationEventDto['type'], actor: UserMiniDto | null, text: string, at: number): ConversationEventDto {
    return { id: nid('e'), conversationId, type, actor, data: null, text, createdAt: iso(at) };
  }
  function contact(id: string, first: string | null, last: string | null, phone: string, labels: LabelDto[], extra: Partial<ContactDto> = {}): ContactDto {
    const display = [first, last].filter(Boolean).join(' ') || phone;
    return {
      id, phoneE164: phone, waId: phone.slice(1), firstName: first, lastName: last, displayName: display, profileName: null, email: null, company: null,
      customerCode: null, taxId: null, landline: null, notes: null, consentStatus: 'GRANTED', consentAt: iso(30 * 24 * hour), phoneInvalid: false,
      labels, conversationId: null, lastActivityAt: null, createdAt: iso(90 * 24 * hour), updatedAt: iso(hour), ...extra,
    };
  }
  function conv(id: string, c: ContactDto, p: Partial<Conv>): Conv {
    return {
      id, contactId: c.id, displayName: c.displayName, phoneE164: c.phoneE164, status: 'OPEN', snoozedUntil: null, assignee: null, starred: false,
      unreadCount: 0, lastMessageAt: null, lastMessagePreview: null, lastMessageKind: null, lastMessageDirection: null, windowExpiresAt: null,
      contactLabels: c.labels, conversationLabels: [], lastCampaignName: null, lastInboundAt: null, windowOpen: false, contact: { ...c, conversationId: id }, ...p,
    };
  }
  /** Recalcula resumen de la conversación a partir de su historial. */
  function refresh(c: Conv) {
    const list = msgs[c.id] ?? [];
    const last = [...list].reverse().find((x) => x.kind !== 'NOTE' && x.direction !== 'INTERNAL') ?? list[list.length - 1];
    if (last) {
      c.lastMessageAt = last.createdAt;
      c.lastMessageKind = last.kind;
      c.lastMessageDirection = last.direction;
      c.lastMessagePreview = last.body ?? ({ IMAGE: 'Foto', VOICE: 'Nota de voz', AUDIO: 'Audio', DOCUMENT: last.media?.fileName ?? 'Documento', VIDEO: 'Vídeo', LOCATION: 'Ubicación', CONTACTS: 'Contacto', STICKER: 'Sticker' } as Record<string, string>)[last.kind] ?? null;
    }
    const inbound = [...list].reverse().find((x) => x.direction === 'INBOUND' && x.kind !== 'REACTION');
    c.lastInboundAt = inbound?.createdAt ?? null;
    c.windowExpiresAt = inbound ? new Date(new Date(inbound.createdAt).getTime() + 24 * hour).toISOString() : null;
    c.windowOpen = !!c.windowExpiresAt && new Date(c.windowExpiresAt).getTime() > now();
    c.displayName = c.contact.displayName;
    c.contactLabels = c.contact.labels;
  }

  function seed() {
    seq = 1;
    const P = lab('l-pel'), B = lab('l-bar'), E = lab('l-est'), I = lab('l-ins'), J = lab('l-jub');
    const cm = contact('ct-1', 'Peluquería', 'Marisol', '+34612345678', [P], { company: 'Peluquería Marisol SL', profileName: 'Marisol Peluqueras' });
    const cb = contact('ct-2', 'Barbería', 'El Puerto', '+34622111222', [B]);
    const ce = contact('ct-3', 'Estética', 'Aura', '+34633222333', [E]);
    const cn = contact('ct-4', 'Salón', 'Nuria', '+34644333444', [P]);
    const cj = contact('ct-5', 'Javier', 'Torres', '+34655444555', []);
    const cp = contact('ct-6', null, null, '+34600112233', [], { consentStatus: 'UNKNOWN', consentAt: null });
    const ci = contact('ct-7', 'Instituto', 'Belleza Sur', '+34666555666', [I]);
    const cc = contact('ct-8', 'Peluquería', 'Cristal', '+34677666777', [P]);
    const cs = contact('ct-9', 'Sonia', 'Vidal', '+34655000111', [E]);
    const cd = contact('ct-10', 'Driss', 'L.', '+34688777888', [B]);
    const ca = contact('ct-11', 'Antonio', 'Ruiz', '+34699888999', [J], { consentStatus: 'REVOKED' });
    const cl = contact('ct-12', 'Estética', 'Lumière', '+34611222333', [E]);

    convs = [
      conv('c1', cm, { assignee: ME, conversationLabels: [lab('t-ped')] }),
      conv('c2', cb, { assignee: LOLO, unreadCount: 2 }),
      conv('c3', ce, { assignee: CRIS, unreadCount: 1 }),
      conv('c4', cn, { assignee: LOLO, unreadCount: 4 }),
      conv('c5', cj, { assignee: CRIS, starred: true, conversationLabels: [lab('t-fac')] }),
      conv('c6', cp, {}),
      conv('c7', ci, { assignee: ME, unreadCount: 1 }),
      conv('c8', cc, { assignee: ME, conversationLabels: [lab('t-tra')] }),
      conv('c9', cs, { status: 'SNOOZED', snoozedUntil: new Date(now() + 2 * 24 * hour).toISOString(), assignee: CRIS }),
      conv('c10', cd, { status: 'SNOOZED', snoozedUntil: new Date(now() + 26 * hour).toISOString() }),
      conv('c11', ca, { status: 'DONE', assignee: LOLO }),
      conv('c12', cl, { unreadCount: 1 }),
    ];

    const photo = mediaOf('img', 'Imagen de la promoción');
    msgs = {
      c1: [
        m('c1', { direction: 'OUTBOUND', kind: 'TEMPLATE', at: 20 * 24 * hour + 5 * hour, body: 'Tenemos algo para ti. PROMOCIÓN ESPECIAL: con la compra de 24 tubos de tinte, llévate de regalo 4 oxidantes de 20 vol. y 2 toallitas quitamanchas.', templateName: 'promo_tintes', media: photo, campaignName: 'Tintes KUKIT + Toallitas', payload: { buttons: ['No recibir más'] } }),
        m('c1', { direction: 'OUTBOUND', kind: 'AUTO_REPLY', at: 3 * hour, body: 'Gracias por escribir a Exclusivas Gelado. Ahora mismo estamos fuera de horario; te responderemos lo antes posible. Mientras, dinos en qué podemos ayudarte:', payload: { buttons: ['Hacer un pedido', 'Necesito factura', 'Duda o consulta'] } }),
        m('c1', { direction: 'INBOUND', kind: 'BUTTON_REPLY', at: 3 * hour - 2 * min, body: 'Hacer un pedido' }),
        m('c1', { direction: 'INBOUND', kind: 'VOICE', at: 3 * hour - 3 * min, media: mediaOf('audio', 'nota-de-voz.ogg') }),
        m('c1', { direction: 'INBOUND', kind: 'IMAGE', at: 3 * hour - 4 * min, body: 'Necesito este y la carta de color de Dousse', media: mediaOf('img', 'Foto: tinte 7.43 agotado', { mimeType: 'image/svg+xml' }) }),
        m('c1', { direction: 'OUTBOUND', kind: 'DOCUMENT', at: 2.5 * hour, sentBy: ME, body: 'Te paso la carta actualizada. Del 7.43 tenemos 12 unidades.', media: mediaOf('pdf', 'DOUSSE Carta de Color.pdf'), reactions: [{ emoji: '👍', direction: 'INBOUND', at: iso(2 * hour) }] }),
        m('c1', { direction: 'INTERNAL', kind: 'NOTE', at: 2.2 * hour, sentBy: ME, status: 'SENT', body: 'Pedido pasado a almacén. Lolo lo prepara para la ruta de mañana.' }),
        m('c1', { direction: 'OUTBOUND', kind: 'TEXT', at: 2 * hour, sentBy: ME, status: 'READ', body: 'Perfecto, lo preparamos hoy mismo y sale mañana en la ruta. *Gracias* por avisar, https://gelado.example/pedidos' }),
      ],
      c2: [
        m('c2', { direction: 'OUTBOUND', kind: 'TEXT', at: 21 * hour, sentBy: LOLO, body: 'Buenas tardes, ¿en qué podemos ayudarte?' }),
        m('c2', { direction: 'INBOUND', kind: 'TEXT', at: 20 * hour, body: '¿Tenéis cuchillas de repuesto para la detailer?' }),
        m('c2', { direction: 'INBOUND', kind: 'TEXT', at: 20 * hour - min, body: 'Es para el sábado, si puede ser' }),
      ],
      c3: [
        m('c3', { direction: 'INBOUND', kind: 'TEXT', at: 23 * hour, body: 'Buenas tardes, me han gustado los productos de vuestro catálogo. ¿Qué descuento hacéis por volumen?' }),
      ],
      c4: [
        m('c4', { direction: 'OUTBOUND', kind: 'TEXT', at: 6 * hour, sentBy: LOLO, body: 'Te recomiendo la mascarilla nutritiva de 500 ml.' }),
        m('c4', { direction: 'INBOUND', kind: 'TEXT', at: 5 * hour, body: 'Me interesa' }),
        m('c4', { direction: 'INBOUND', kind: 'TEXT', at: 5 * hour - min, body: '¿Cuánto cuesta?' }),
        m('c4', { direction: 'INBOUND', kind: 'TEXT', at: 5 * hour - 2 * min, body: '¿Y envío?' }),
        m('c4', { direction: 'INBOUND', kind: 'TEXT', at: 5 * hour - 3 * min, body: '¿La tenéis en stock?' }),
      ],
      c5: [
        m('c5', { direction: 'INBOUND', kind: 'TEXT', at: 3 * 24 * hour, body: 'Necesito la factura de octubre' }),
        m('c5', { direction: 'OUTBOUND', kind: 'DOCUMENT', at: 3 * 24 * hour - 10 * min, sentBy: CRIS, media: mediaOf('pdf', 'Factura A-2026-1187.pdf') }),
        m('c5', { direction: 'INBOUND', kind: 'TEXT', at: 3 * 24 * hour - 20 * min, body: 'Necesito la factura de octubre' }),
      ],
      c6: [
        m('c6', { direction: 'INBOUND', kind: 'TEXT', at: 3 * 24 * hour, body: 'Hola, ¿hacéis envíos a Murcia?' }),
      ],
      c7: [
        m('c7', { direction: 'INBOUND', kind: 'TEXT', at: 90 * min, body: 'Os paso la ubicación del instituto para la entrega' }),
        m('c7', { direction: 'INBOUND', kind: 'LOCATION', at: 89 * min, payload: { latitude: 37.9922, longitude: -1.1307, name: 'Instituto Belleza Sur', address: 'Calle Mayor 12, Murcia' } }),
        m('c7', { direction: 'INBOUND', kind: 'CONTACTS', at: 80 * min, payload: [{ name: { formatted_name: 'Laura Gómez (almacén)' }, phones: [{ phone: '+34 611 000 222' }] }] }),
      ],
      c8: [
        m('c8', { direction: 'INBOUND', kind: 'VIDEO', at: 5 * hour, media: { id: nid('media'), mimeType: 'video/mp4', sizeBytes: 3_400_000, fileName: 'video.mp4', url: null } }),
        m('c8', { direction: 'INBOUND', kind: 'STICKER', at: 4.9 * hour, media: mediaOf('img', '😀', { mimeType: 'image/webp' }) }),
        m('c8', { direction: 'INBOUND', kind: 'UNSUPPORTED', at: 4.8 * hour, payload: { type: 'order' } }),
        m('c8', { direction: 'OUTBOUND', kind: 'TEXT', at: 4 * hour, sentBy: ME, body: 'Ahora mismo te paso precio.', status: 'FAILED', errorCode: 131000, errorTitle: 'Error temporal de WhatsApp. Inténtalo de nuevo.', retryable: true, readAt: null, deliveredAt: null }),
        m('c8', { direction: 'OUTBOUND', kind: 'TEXT', at: 3.9 * hour, sentBy: ME, body: 'Te mando también el catálogo.', status: 'FAILED', errorCode: 131047, errorTitle: 'Han pasado más de 24 h desde el último mensaje del cliente: usa una plantilla.', retryable: false, readAt: null, deliveredAt: null }),
        m('c8', { direction: 'INBOUND', kind: 'TEXT', at: 3 * hour, body: 'Gracias, espero' }),
      ],
      c9: [
        m('c9', { direction: 'OUTBOUND', kind: 'TEMPLATE', at: 20 * 24 * hour, body: 'Tenemos algo para ti. PROMOCIÓN ESPECIAL…', templateName: 'promo_estetica', campaignName: 'Promo estética' }),
      ],
      c10: [
        m('c10', { direction: 'OUTBOUND', kind: 'TEMPLATE', at: 19 * 24 * hour, body: 'Tenemos algo para ti. PROMOCIÓN ESPECIAL…', templateName: 'promo_estetica' }),
      ],
      c11: [
        m('c11', { direction: 'INBOUND', kind: 'TEXT', at: 9 * 24 * hour, body: 'Gracias por todo, hasta pronto' }),
      ],
      c12: [
        m('c12', { direction: 'INBOUND', kind: 'IMAGE', at: 30 * min, body: 'Mirad qué desastre', media: { id: nid('media'), mimeType: 'image/jpeg', sizeBytes: 900_000, fileName: null, url: null, pending: true } }),
      ],
    };
    evts = {
      c1: [ev('c1', 'DONE', CRIS, 'Cristina Lopez ha marcado el chat como finalizado', 20 * 24 * hour), ev('c1', 'ASSIGNED', ME, 'María Iborra se ha asignado la conversación', 2.9 * hour), ev('c1', 'LABEL_ADDED', ME, 'María Iborra ha añadido la etiqueta PEDIDO', 2.8 * hour)],
      c9: [ev('c9', 'SNOOZED', CRIS, 'Cristina Lopez ha pospuesto el chat', 2 * hour)],
    };
    // una cita en c4
    const q = msgs.c4![0]!;
    msgs.c4![1]!.quoted = { id: q.id, body: q.body, kind: q.kind, direction: q.direction };
    // mensaje ya sin texto de c1 reaction
    convs.forEach(refresh);

    folders = [
      { id: 'f-cat', name: 'Catálogos', parentId: null, sortOrder: 1, fileCount: 6 },
      { id: 'f-col', name: 'Cartas de color', parentId: null, sortOrder: 2, fileCount: 2 },
      { id: 'f-pro', name: 'Promociones', parentId: null, sortOrder: 3, fileCount: 2 },
    ];
    const pdf = (id: string, name: string, folderId: string, size: number): LibraryFileDto => ({ id, folderId, name, createdAt: iso(10 * 24 * hour), media: { id: `lm-${id}`, mimeType: 'application/pdf', sizeBytes: size, fileName: `${name}.pdf`, url: PDF_URI } });
    files = [
      pdf('lf-1', 'ALLE LAC Catálogo', 'f-cat', 3_100_000), pdf('lf-2', 'CRAZY COLOR Catálogo', 'f-cat', 5_800_000), pdf('lf-3', 'DARNIER Catálogo', 'f-cat', 2_200_000),
      pdf('lf-4', 'DOUSSE Carta de Color', 'f-col', 2_400_000), pdf('lf-5', 'Eléctrico RAGNAR Catálogo', 'f-cat', 4_000_000), pdf('lf-6', 'ELEGANCE Extensiones Color', 'f-cat', 1_700_000),
      pdf('lf-7', 'KUKIT Carta de Color', 'f-col', 1_900_000),
      { id: 'lf-8', folderId: 'f-pro', name: 'Promo tintes', createdAt: iso(5 * 24 * hour), media: { id: 'lm-lf-8', mimeType: 'image/svg+xml', sizeBytes: 120_000, fileName: 'promo-tintes.png', url: svg('Promo tintes', 640, 400, '#C2333A', '#7A1D22') } },
      { id: 'lf-9', folderId: 'f-pro', name: 'Promo toallitas', createdAt: iso(4 * 24 * hour), media: { id: 'lm-lf-9', mimeType: 'image/svg+xml', sizeBytes: 98_000, fileName: 'promo-toallitas.png', url: svg('Promo toallitas', 640, 400, '#1F6F8B', '#123E50') } },
    ];
  }

  const inView = (c: Conv, v: InboxView) =>
    v === 'all' ? true : v === 'mine' ? c.assignee?.id === ME.id : v === 'unassigned' ? !c.assignee : v === 'unread' ? c.unreadCount > 0 : c.starred;

  function counts(): InboxCountsDto {
    const open = convs.filter((c) => c.status === 'OPEN');
    const byLabel: Record<string, number> = {};
    for (const c of open) for (const l of [...c.contactLabels, ...c.conversationLabels]) byLabel[l.id] = (byLabel[l.id] ?? 0) + 1;
    for (const l of LABELS) byLabel[l.id] ??= 0;
    return {
      views: { all: open.length, mine: open.filter((c) => inView(c, 'mine')).length, unassigned: open.filter((c) => inView(c, 'unassigned')).length, unread: open.filter((c) => inView(c, 'unread')).length, starred: open.filter((c) => inView(c, 'starred')).length },
      byLabel,
      tabs: { OPEN: open.length, SNOOZED: convs.filter((c) => c.status === 'SNOOZED').length, DONE: convs.filter((c) => c.status === 'DONE').length } as Record<ConversationStatus, number>,
      totalUnread: convs.reduce((n, c) => n + c.unreadCount, 0),
    };
  }
  function toItem(c: Conv, snippet?: string | null): ConversationListItemDto {
    const { lastInboundAt: _a, windowOpen: _b, contact: _c, ...item } = c;
    return { ...item, searchSnippet: snippet ?? null };
  }
  const emitConv = (c: Conv) => {
    mockBus.emit('conversation.updated', { conversation: toItem(c) });
    mockBus.emit('badge.counts', counts());
  };
  const get = (id: string) => {
    const c = convs.find((x) => x.id === id);
    if (!c) throw new HttpError(404, { statusCode: 404, message: 'Conversación no encontrada' });
    return c;
  };
  function addEvent(c: Conv, type: ConversationEventDto['type'], text: string) {
    const e = ev(c.id, type, ME, text, 0);
    (evts[c.id] ??= []).push(e);
    mockBus.emit('event.created', { conversationId: c.id, event: e });
  }
  function push(c: Conv, message: MessageDto) {
    (msgs[c.id] ??= []).push(message);
    refresh(c);
    mockBus.emit('message.created', { conversationId: c.id, message, notify: message.direction === 'INBOUND' });
    emitConv(c);
  }
  function progress(c: Conv, message: MessageDto) {
    const steps: Array<[number, 'SENT' | 'DELIVERED' | 'READ']> = [[400, 'SENT'], [1500, 'DELIVERED'], [4000, 'READ']];
    for (const [ms, status] of steps) {
      setTimeout(() => {
        if (message.status === 'FAILED') return;
        message.status = status;
        const at = new Date().toISOString();
        if (status === 'SENT') message.sentAt = at;
        if (status === 'DELIVERED') message.deliveredAt = at;
        if (status === 'READ') message.readAt = at;
        mockBus.emit('message.status', { conversationId: c.id, messageId: message.id, status, errorCode: null, errorTitle: null, at });
      }, ms);
    }
  }

  seed();

  const api: InboxApi & { _reset(): void; simulateIncoming(conversationId?: string, text?: string): void } = {
    _reset: () => seed(),
    simulateIncoming(conversationId = 'c2', text = 'Hola, ¿sigue disponible?') {
      const c = get(conversationId);
      c.unreadCount += 1;
      if (c.status !== 'OPEN') c.status = 'OPEN';
      push(c, m(c.id, { direction: 'INBOUND', kind: 'TEXT', at: 0, body: text }));
    },

    async listConversations(p: ListParams) {
      const view = p.view ?? 'all';
      const status = p.status ?? 'OPEN';
      const q = (p.q ?? '').trim().toLowerCase();
      let list = convs.filter((c) => c.status === status && inView(c, view));
      if (p.labelId) list = list.filter((c) => c.contactLabels.some((l) => l.id === p.labelId));
      if (p.conversationLabelId) list = list.filter((c) => c.conversationLabels.some((l) => l.id === p.conversationLabelId));
      if (p.assigneeId) list = list.filter((c) => c.assignee?.id === p.assigneeId);
      const snippets: Record<string, string> = {};
      if (q) {
        list = list.filter((c) => {
          if (c.displayName.toLowerCase().includes(q) || c.phoneE164.includes(q.replace(/\s/g, ''))) return true;
          const hit = (msgs[c.id] ?? []).find((x) => x.body?.toLowerCase().includes(q));
          if (hit) snippets[c.id] = hit.body!;
          return !!hit;
        });
      }
      list = [...list].sort((a, b) =>
        status === 'SNOOZED' ? (a.snoozedUntil ?? '').localeCompare(b.snoozedUntil ?? '') : (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
      const start = Number(p.cursor ?? 0);
      const limit = p.limit ?? 50;
      const page = list.slice(start, start + limit).map((c) => toItem(c, snippets[c.id]));
      return wait({ items: page, nextCursor: start + limit < list.length ? String(start + limit) : null } satisfies CursorPage<ConversationListItemDto>);
    },
    counts: () => wait(counts()),
    async newConversation(body) {
      const phone = body.phone.replace(/[\s-]/g, '');
      if (!/^\+?\d{6,15}$/.test(phone)) throw new HttpError(400, { statusCode: 400, message: 'El teléfono no es válido' });
      const e164 = phone.startsWith('+') ? phone : `+34${phone}`;
      const found = convs.find((c) => c.phoneE164 === e164);
      if (found) return wait(found);
      const ct = contact(nid('ct'), body.firstName ?? null, null, e164, [], { consentStatus: 'UNKNOWN', consentAt: null });
      const c = conv(nid('c'), ct, {});
      msgs[c.id] = [];
      convs.unshift(c);
      emitConv(c);
      return wait(c);
    },
    getConversation: async (id) => wait(get(id)),
    async timeline(id, p) {
      get(id);
      const all: TimelineItemDto[] = [
        ...(msgs[id] ?? []).map((message) => ({ type: 'message' as const, at: message.createdAt, message })),
        ...(evts[id] ?? []).map((event) => ({ type: 'event' as const, at: event.createdAt, event })),
      ].sort((a, b) => a.at.localeCompare(b.at));
      const limit = p.limit ?? 40;
      const end = p.cursor != null ? Number(p.cursor) : all.length;
      const start = Math.max(0, end - limit);
      return wait({ items: all.slice(start, end), nextCursor: start > 0 ? String(start) : null });
    },
    async sendMessage(id, dto: SendMessageDto) {
      const c = get(id);
      const open = !!c.windowExpiresAt && new Date(c.windowExpiresAt).getTime() > now();
      if (dto.type !== 'note' && dto.type !== 'template' && !open)
        throw new HttpError(409, { statusCode: 409, message: 'La ventana de 24 h está cerrada: solo se pueden enviar plantillas.' });
      let message: MessageDto;
      if (dto.type === 'note') {
        message = m(id, { direction: 'INTERNAL', kind: 'NOTE', at: 0, sentBy: ME, status: 'SENT', body: dto.body });
      } else if (dto.type === 'text') {
        const quoted = dto.replyToMessageId ? (msgs[id] ?? []).find((x) => x.id === dto.replyToMessageId) : null;
        message = m(id, { direction: 'OUTBOUND', kind: 'TEXT', at: 0, sentBy: ME, status: 'PENDING', body: dto.body, deliveredAt: null, readAt: null, sentAt: null,
          quoted: quoted ? { id: quoted.id, body: quoted.body, kind: quoted.kind, direction: quoted.direction } : null });
      } else if (dto.type === 'media') {
        const sel = dto.mediaFileIds.map((mid) => uploads.get(mid) ?? files.find((f) => f.media.id === mid)?.media).filter(Boolean) as MediaDto[];
        const first = sel[0]!;
        const kind: MessageKind = dto.voice ? 'VOICE' : first.mimeType.startsWith('image/') ? 'IMAGE' : first.mimeType.startsWith('audio/') ? 'AUDIO' : first.mimeType.startsWith('video/') ? 'VIDEO' : 'DOCUMENT';
        message = m(id, { direction: 'OUTBOUND', kind, at: 0, sentBy: ME, status: 'PENDING', media: first, body: dto.caption ?? null, deliveredAt: null, readAt: null, sentAt: null });
      } else {
        const t = TEMPLATES.find((x) => x.id === dto.templateId);
        if (!t) throw new HttpError(404, { statusCode: 404, message: 'Plantilla no encontrada' });
        const values: Record<number, string> = {};
        for (const n of extractVariables(t.components.find((x) => x.type === 'BODY')?.text)) values[n] = dto.params[`body.${n}`] ?? '';
        const buttons = t.components.find((x) => x.type === 'BUTTONS')?.buttons?.map((b) => b.text) ?? [];
        const header = dto.headerMediaFileId ? files.find((f) => f.media.id === dto.headerMediaFileId)?.media ?? uploads.get(dto.headerMediaFileId) ?? null : null;
        message = m(id, { direction: 'OUTBOUND', kind: 'TEMPLATE', at: 0, sentBy: ME, status: 'PENDING', body: renderTemplateText(t.components.find((x) => x.type === 'BODY')?.text, values), templateName: t.name, templateParams: dto.params, payload: { buttons }, media: header, deliveredAt: null, readAt: null, sentAt: null });
      }
      if (c.status !== 'OPEN' && dto.type !== 'note') {
        c.status = 'OPEN';
        c.snoozedUntil = null;
      }
      push(c, message);
      if (dto.type !== 'note') progress(c, message);
      return wait(message);
    },
    async retryMessage(id, messageId) {
      const c = get(id);
      const message = (msgs[id] ?? []).find((x) => x.id === messageId);
      if (!message || !message.retryable) throw new HttpError(409, { statusCode: 409, message: 'Este mensaje no se puede reintentar' });
      message.status = 'PENDING';
      message.errorCode = null;
      message.errorTitle = null;
      message.retryable = false;
      mockBus.emit('message.status', { conversationId: id, messageId, status: 'PENDING', errorCode: null, errorTitle: null, at: new Date().toISOString() });
      progress(c, message);
      return wait(message);
    },
    async markRead(id) { const c = get(id); c.unreadCount = 0; emitConv(c); return wait(undefined); },
    async markUnread(id) { const c = get(id); c.unreadCount = Math.max(1, c.unreadCount); emitConv(c); return wait(undefined); },
    async assign(id, assigneeId) {
      const c = get(id);
      c.assignee = USERS.find((u) => u.id === assigneeId) ?? null;
      addEvent(c, c.assignee ? 'ASSIGNED' : 'UNASSIGNED', c.assignee ? `María Iborra ha asignado la conversación a ${c.assignee.name}` : 'María Iborra ha quitado la asignación');
      emitConv(c);
      return wait(undefined);
    },
    async snooze(id, dto) {
      const c = get(id);
      const until = dto.preset === 'custom' ? dto.until! : snoozeOptions().find((o) => o.preset === dto.preset)!.at.toISOString();
      c.status = 'SNOOZED';
      c.snoozedUntil = until;
      addEvent(c, 'SNOOZED', `María Iborra ha pospuesto el chat hasta el ${new Date(until).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
      emitConv(c);
      return wait(undefined);
    },
    async done(id) { const c = get(id); c.status = 'DONE'; c.snoozedUntil = null; addEvent(c, 'DONE', 'María Iborra ha marcado el chat como finalizado'); emitConv(c); return wait(undefined); },
    async reopen(id) { const c = get(id); c.status = 'OPEN'; c.snoozedUntil = null; addEvent(c, 'REOPENED', 'María Iborra ha reabierto el chat'); emitConv(c); return wait(undefined); },
    async star(id, starred) { const c = get(id); c.starred = starred; emitConv(c); return wait(undefined); },
    async setLabels(id, dto) {
      const c = get(id);
      c.conversationLabels = [...c.conversationLabels.filter((l) => !dto.remove.includes(l.id)), ...dto.add.filter((a) => !c.conversationLabels.some((l) => l.id === a)).map(lab)];
      dto.add.forEach((a) => addEvent(c, 'LABEL_ADDED', `María Iborra ha añadido la etiqueta ${lab(a).name}`));
      dto.remove.forEach((a) => addEvent(c, 'LABEL_REMOVED', `María Iborra ha quitado la etiqueta ${lab(a).name}`));
      emitConv(c);
      return wait(undefined);
    },
    async uploadMedia(file, fileName) {
      const f = file as File;
      const media: MediaDto = {
        id: nid('up'), mimeType: f.type || 'application/octet-stream', sizeBytes: f.size, fileName: fileName ?? f.name ?? 'archivo',
        url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null,
      };
      uploads.set(media.id, media);
      return wait(media);
    },
    libraryFolders: () => wait(folders),
    async libraryFiles(p) {
      const q = (p.q ?? '').trim().toLowerCase();
      return wait(files.filter((f) => (!p.folderId || f.folderId === p.folderId) && (!q || f.name.toLowerCase().includes(q))));
    },
    approvedTemplates: () => wait(TEMPLATES),
    rates: () => wait(RATES),
    users: () => wait(USERS.map((u) => ({ id: u.id, name: u.name, active: true }))),
    labels: () => wait(LABELS),
  };
  const uploads = new Map<string, MediaDto>();
  return api;
}

export const mockApi = createMockApi();

/** Modo simulado: sesión falsa para poder ver la bandeja sin backend (solo /api/auth/me y /api/alerts). */
export function installMockAuth() {
  const orig = window.fetch.bind(window);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (url.startsWith('/api/auth/me')) return Promise.resolve(json({ id: ME.id, email: 'maria@gelado.example', name: ME.name, role: 'ADMIN' }));
    if (url.startsWith('/api/alerts')) return Promise.resolve(json([]));
    if (url.startsWith('/api/auth/logout')) return Promise.resolve(new Response(null, { status: 204 }));
    return orig(input, init);
  };
  (window as any).__geladoMock = mockApi;
}

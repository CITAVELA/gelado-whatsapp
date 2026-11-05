import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, PNG_1X1, seedConversation, seedTemplate, type WaTestEnv } from './meta-simulator/harness';
import { QUEUES } from '../src/modules/jobs/jobs.service';
import { MediaService } from '../src/modules/media/media.service';
import { MessagingService, WINDOW_CLOSED_MESSAGE } from '../src/modules/whatsapp/messaging.service';

let env: WaTestEnv;
let messaging: MessagingService;
beforeAll(async () => {
  env = await createWaTestEnv();
  messaging = env.t.app.get(MessagingService);
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});

const FROM = '34600111222';

describe('S1 · Ventana de 24 h (prueba 4)', () => {
  it('texto y adjuntos con la ventana cerrada → 409 con mensaje claro y nada se crea ni se envía', async () => {
    const { conversation } = await seedConversation(env.t, { windowOpen: false });
    const f = await env.t.app.get(MediaService).storeBuffer(PNG_1X1, 'image/png', 'a.png', 'UPLOAD');
    for (const p of [messaging.sendText(conversation.id, 'Hola'), messaging.sendMedia(conversation.id, [f.id]), messaging.sendInteractiveButtons(conversation.id, 'x', [{ id: 'a', title: 'A' }])]) {
      await expect(p).rejects.toMatchObject({ status: 409, response: { message: WINDOW_CLOSED_MESSAGE } });
    }
    expect(await env.t.prisma.message.count()).toBe(0);
    expect(env.sim.sent).toHaveLength(0);
  });

  it('una plantilla sí puede enviarse con la ventana cerrada y queda marcada sentOutsideWindow', async () => {
    const { conversation } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, { 'body.1': 'Ginés', 'button.0': 'tintes' });
    expect(m).toMatchObject({ status: 'SENT', sentOutsideWindow: true, kind: 'TEMPLATE' });
  });

  it('con la ventana abierta la plantilla no cuenta como fuera de ventana', async () => {
    const { conversation } = await seedConversation(env.t);
    const tpl = await seedTemplate(env.t, { header: false });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, { 'body.1': 'Ginés', 'button.0': 'x' });
    expect(m.sentOutsideWindow).toBe(false);
  });

  it('131047 de Meta → FAILED con motivo en español, sin reintento y la conversación sigue', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.failNext({ code: 131047, path: 'messages' });
    const m = await messaging.sendText(conversation.id, 'Hola');
    expect(m).toMatchObject({ status: 'FAILED', errorCode: 131047, wamid: null });
    expect(m.errorTitle).toMatch(/ventana de 24 h está cerrada/);
    expect(env.sim.sent).toHaveLength(0);
    expect(env.t.jobs.inlineErrors).toHaveLength(0); // no se reintenta
    const st = env.domain.filter((d) => d.event === 'message.status').map((d) => d.payload);
    expect(st.at(-1)).toMatchObject({ status: 'FAILED', errorCode: 131047 });
    // el DTO dice que no es reintentable
    const dto = (env.realtime.emitted.filter((e) => e.event === 'message.status').at(-1)!.payload as any);
    expect(dto.errorCode).toBe(131047);
    await expect(messaging.retry(m.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe('S1 · Envíos', () => {
  it('texto: crea PENDING, actualiza la conversación, emite y envía; con cita usa context', async () => {
    const { conversation } = await seedConversation(env.t);
    const quoted = await env.t.prisma.message.create({ data: { conversationId: conversation.id, direction: 'INBOUND', kind: 'TEXT', body: 'Pregunta', status: 'RECEIVED', wamid: 'wamid.Q1' } });
    const user = await env.t.prisma.user.findFirstOrThrow();
    const m = await messaging.sendText(conversation.id, '  Respuesta  ', { userId: user.id, replyToMessageId: quoted.id });
    expect(m).toMatchObject({ status: 'SENT', body: 'Respuesta', sentById: user.id, contextWamid: 'wamid.Q1' });
    expect(m.wamid).toMatch(/^wamid\./);
    expect(env.sim.sent[0]!.body).toMatchObject({ messaging_product: 'whatsapp', to: FROM, type: 'text', text: { body: 'Respuesta' }, context: { message_id: 'wamid.Q1' } });
    const conv = await env.t.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conv).toMatchObject({ lastMessagePreview: 'Respuesta', lastMessageDirection: 'OUTBOUND', lastMessageKind: 'TEXT' });
    const created = env.realtime.emitted.find((e) => e.event === 'message.created')!.payload as any;
    expect(created.message).toMatchObject({ direction: 'OUTBOUND', status: 'PENDING', sentBy: { id: user.id }, quoted: { body: 'Pregunta' } });
    expect(env.realtime.emitted.some((e) => e.event === 'conversation.updated')).toBe(true);
    expect(env.realtime.emitted.some((e) => e.event === 'message.status')).toBe(true);
  });

  it('texto vacío o demasiado largo → 400; conversación inexistente → 404', async () => {
    const { conversation } = await seedConversation(env.t);
    await expect(messaging.sendText(conversation.id, '   ')).rejects.toMatchObject({ status: 400 });
    await expect(messaging.sendText(conversation.id, 'a'.repeat(4097))).rejects.toMatchObject({ status: 400 });
    await expect(messaging.sendText('00000000-0000-4000-8000-000000000000', 'x')).rejects.toMatchObject({ status: 404 });
  });

  it('media: un mensaje por archivo con el pie en el primero; sube a WhatsApp una vez por archivo', async () => {
    const { conversation } = await seedConversation(env.t);
    const media = env.t.app.get(MediaService);
    const img = await media.storeBuffer(PNG_1X1, 'image/png', 'foto.png', 'UPLOAD');
    const pdf = await media.storeBuffer(Buffer.from('%PDF-1.4 x'), 'application/pdf', 'DOUSSE Carta de Color.pdf', 'UPLOAD');
    const msgs = await messaging.sendMedia(conversation.id, [img.id, pdf.id], { caption: 'Te envío esto' });
    expect(msgs.map((m) => [m.kind, m.body, m.status])).toEqual([['IMAGE', 'Te envío esto', 'SENT'], ['DOCUMENT', null, 'SENT']]);
    const [a, b] = env.sim.sent.map((s) => s.body);
    expect(a).toMatchObject({ type: 'image', image: { caption: 'Te envío esto' } });
    expect(a.image.id).toMatch(/^\d+$/);
    expect(b).toMatchObject({ type: 'document', document: { filename: 'DOUSSE Carta de Color.pdf' } });
    expect(b.document.caption).toBeUndefined();
    // reenviar la imagen reutiliza el id de WhatsApp (no vuelve a subir)
    const before = env.sim.media.size;
    await messaging.sendMedia(conversation.id, [img.id]);
    expect(env.sim.media.size).toBe(before);
    const conv = await env.t.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conv.lastMessagePreview).toBe('📷 Foto');
  });

  it('plantilla: componentes de cabecera, cuerpo, botón URL y payload OPT_OUT en el botón de baja', async () => {
    const { conversation } = await seedConversation(env.t);
    const tpl = await seedTemplate(env.t);
    const media = env.t.app.get(MediaService);
    const img = await media.storeBuffer(PNG_1X1, 'image/png', 'cabecera.png', 'UPLOAD');
    const m = await messaging.sendTemplate(conversation.id, tpl.id, { 'body.1': 'Ginés\nPérez', 'button.0': 'tintes' }, { headerMediaFileId: img.id });
    expect(m).toMatchObject({ kind: 'TEMPLATE', status: 'SENT', body: 'Hola Ginés Pérez, mira nuestras novedades', templateId: tpl.id, mediaId: img.id });
    const t = env.sim.sent[0]!.body;
    expect(t.type).toBe('template');
    expect(t.template).toMatchObject({ name: 'campana_imagen', language: { code: 'es' } });
    const comps = t.template.components;
    expect(comps[0]).toMatchObject({ type: 'header', parameters: [{ type: 'image', image: { id: expect.stringMatching(/^\d+$/) } }] });
    expect(comps[1]).toEqual({ type: 'body', parameters: [{ type: 'text', text: 'Ginés Pérez' }] });
    expect(comps[2]).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'tintes' }] });
    expect(comps[3]).toEqual({ type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'OPT_OUT' }] });
    const conv = await env.t.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conv.lastMessagePreview).toContain('Campaña con imagen');
  });

  it('plantilla: valida estado, variables y cabecera; campaignId actualiza lastCampaignId', async () => {
    const { conversation } = await seedConversation(env.t);
    const tpl = await seedTemplate(env.t);
    await expect(messaging.sendTemplate(conversation.id, tpl.id, { 'body.1': 'x', 'button.0': 'y' })).rejects.toMatchObject({ response: { message: expect.stringMatching(/cabecera/) } });
    const img = await env.t.app.get(MediaService).storeBuffer(PNG_1X1, 'image/png', 'c.png', 'UPLOAD');
    await expect(messaging.sendTemplate(conversation.id, tpl.id, { 'body.1': 'x' }, { headerMediaFileId: img.id })).rejects.toMatchObject({ response: { message: 'Faltan variables de la plantilla: button.0' } });
    const pending = await seedTemplate(env.t, { status: 'PENDING' }).catch(() => null);
    expect(pending).toBeNull(); // (name, language) único: confirma que no hay duplicados
    await env.t.prisma.template.update({ where: { id: tpl.id }, data: { status: 'PENDING' } });
    await expect(messaging.sendTemplate(conversation.id, tpl.id, {})).rejects.toMatchObject({ status: 409 });
    await env.t.prisma.template.update({ where: { id: tpl.id }, data: { status: 'APPROVED' } });
    const user = await env.t.prisma.user.findFirstOrThrow();
    const camp = await env.t.prisma.campaign.create({ data: { name: 'C', templateId: tpl.id, variableMapping: {}, audience: {}, createdById: user.id } });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, { 'body.1': 'x', 'button.0': 'y' }, { headerMediaFileId: img.id, campaignId: camp.id });
    expect(m.campaignId).toBe(camp.id);
    expect((await env.t.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).lastCampaignId).toBe(camp.id);
  });

  it('un contacto dado de baja no recibe plantillas de marketing (regla 5), pero sí de utilidad', async () => {
    const { conversation } = await seedConversation(env.t, { consent: 'REVOKED', windowOpen: false });
    const mk = await seedTemplate(env.t, { header: false });
    await expect(messaging.sendTemplate(conversation.id, mk.id, { 'body.1': 'x', 'button.0': 'y' })).rejects.toMatchObject({ status: 409, response: { message: expect.stringMatching(/dado de baja/) } });
    expect(env.sim.sent).toHaveLength(0);
    await env.t.prisma.template.update({ where: { id: mk.id }, data: { category: 'UTILITY' } });
    const m = await messaging.sendTemplate(conversation.id, mk.id, { 'body.1': 'x', 'button.0': 'y' });
    expect(m.status).toBe('SENT');
  });

  it('mensaje interactivo con botones (títulos recortados a 20) como AUTO_REPLY', async () => {
    const { conversation } = await seedConversation(env.t);
    const m = await messaging.sendInteractiveButtons(conversation.id, 'Estamos cerrados', [
      { id: 'PEDIDO', title: 'Hacer un pedido' },
      { id: 'FACTURA', title: 'Necesito una factura enseguida' },
    ]);
    expect(m).toMatchObject({ kind: 'AUTO_REPLY', status: 'SENT', body: 'Estamos cerrados' });
    const i = env.sim.sent[0]!.body.interactive;
    expect(i.type).toBe('button');
    expect(i.action.buttons.map((b: any) => b.reply)).toEqual([{ id: 'PEDIDO', title: 'Hacer un pedido' }, { id: 'FACTURA', title: 'Necesito una factura' }]);
    await expect(messaging.sendInteractiveButtons(conversation.id, 'x', [])).rejects.toMatchObject({ status: 400 });
  });

  it('marcar leído avisa a WhatsApp con el último entrante', async () => {
    const { conversation } = await seedConversation(env.t);
    expect(await messaging.markConversationRead(conversation.id)).toBe(false);
    await env.sim.sendInbound({ from: FROM, type: 'text', text: { body: 'uno' }, id: 'wamid.IN1' });
    await env.sim.sendInbound({ from: FROM, type: 'text', text: { body: 'dos' }, id: 'wamid.IN2' });
    await env.sim.sendInbound({ from: FROM, type: 'reaction', reaction: { message_id: 'x', emoji: '👍' }, id: 'wamid.IN3' });
    expect(await messaging.markConversationRead(conversation.id)).toBe(true);
    expect(env.sim.reads).toEqual(['wamid.IN2']);
  });

  it('ensureConversationForContact crea la conversación una sola vez', async () => {
    const c = await env.t.prisma.contact.create({ data: { phoneE164: '+34600999888', waId: '34600999888' } });
    const a = await messaging.ensureConversationForContact(c.id);
    const b = await messaging.ensureConversationForContact(c.id);
    expect(a.id).toBe(b.id);
    expect(a.windowExpiresAt).toBeNull();
    await expect(messaging.ensureConversationForContact('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
  });
});

describe('S1 · Errores y reintentos', () => {
  it('130429 (límite de la API) en ráfaga: reintenta con espera y acaba enviándose', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.failNext({ code: 130429, count: 2, path: 'messages' });
    const m = await messaging.sendText(conversation.id, 'Hola');
    // el job lanzó el error para que pg-boss lo reintente; el mensaje sigue PENDING
    expect(env.t.jobs.inlineErrors).toHaveLength(1);
    let row = await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.status).toBe('PENDING');
    await expect(env.t.jobs.runInline(QUEUES.WA_SEND, { messageId: m.id })).rejects.toMatchObject({ code: 130429 });
    await env.t.jobs.runInline(QUEUES.WA_SEND, { messageId: m.id }); // tercer intento: ya no falla
    row = await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.status).toBe('SENT');
    expect(row.wamid).not.toBeNull();
    expect(env.sim.sent).toHaveLength(1);
    // reejecutar no reenvía (idempotente)
    await env.t.jobs.runInline(QUEUES.WA_SEND, { messageId: m.id });
    expect(env.sim.sent).toHaveLength(1);
  });

  it('al agotar los reintentos el mensaje pasa a FAILED con su motivo y se puede reintentar a mano', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.failNext({ code: 130429, count: 4, path: 'messages' });
    const m = await messaging.sendText(conversation.id, 'Hola');
    for (let i = 0; i < 2; i++) await expect(env.t.jobs.runInline(QUEUES.WA_SEND, { messageId: m.id })).rejects.toBeTruthy();
    await env.t.jobs.runInline(QUEUES.WA_SEND, { messageId: m.id }); // 4.º intento: agotado → FAILED sin lanzar
    let row = await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ status: 'FAILED', errorCode: 130429 });
    expect(row.errorTitle).toMatch(/Límite de envío/);
    const again = await messaging.retry(m.id);
    expect(again.status).toBe('SENT');
    row = await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.errorCode).toBeNull();
  });

  it('fallo 5xx de Meta se trata como temporal', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.failNext({ code: 1, httpStatus: 503, path: 'messages' });
    const m = await messaging.sendText(conversation.id, 'Hola');
    expect((await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('PENDING');
    expect(env.t.jobs.inlineErrors).toHaveLength(1);
  });

  it('error definitivo (132000) → FAILED con motivo en español, sin reintentos; retry() no aplica', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.failNext({ code: 132000, path: 'messages' });
    const m = await messaging.sendText(conversation.id, 'Hola');
    expect(m).toMatchObject({ status: 'FAILED', errorCode: 132000 });
    expect(m.errorTitle).toMatch(/variables de la plantilla/);
    expect(env.t.jobs.inlineErrors).toHaveLength(0);
    await expect(messaging.retry(m.id)).rejects.toMatchObject({ status: 409 });
  });

  it('acciones por código desde el webhook: 131026 repetido → phoneInvalid; 368 y 132015 → sending.blocked', async () => {
    const { conversation, contact } = await seedConversation(env.t);
    const a = await messaging.sendText(conversation.id, 'uno');
    await env.sim.sendStatus({ wamid: a.wamid!, status: 'failed', errorCode: 131026 });
    expect((await env.t.prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).phoneInvalid).toBe(false);
    const b = await messaging.sendText(conversation.id, 'dos');
    await env.sim.sendStatus({ wamid: b.wamid!, status: 'failed', errorCode: 131026 });
    expect((await env.t.prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).phoneInvalid).toBe(true);

    const c = await messaging.sendText(conversation.id, 'tres');
    await env.sim.sendStatus({ wamid: c.wamid!, status: 'failed', errorCode: 368 });
    const tpl = await seedTemplate(env.t, { header: false });
    const user = await env.t.prisma.user.findFirstOrThrow();
    const camp = await env.t.prisma.campaign.create({ data: { name: 'C', templateId: tpl.id, variableMapping: {}, audience: {}, createdById: user.id } });
    const d = await messaging.sendTemplate(conversation.id, tpl.id, { 'body.1': 'x', 'button.0': 'y' }, { campaignId: camp.id });
    await env.sim.sendStatus({ wamid: d.wamid!, status: 'failed', errorCode: 132015 });
    const blocked = env.domain.filter((x) => x.event === 'sending.blocked').map((x) => x.payload);
    expect(blocked[0]).toMatchObject({ code: 368, scope: 'all' });
    expect(blocked[1]).toMatchObject({ code: 132015, scope: 'campaign', campaignId: camp.id, templateId: tpl.id });
  });
});

describe('S1 · Bajas (prueba 5)', () => {
  async function expectOptedOut(source: string) {
    const contact = await env.t.prisma.contact.findFirstOrThrow({ include: { consentEvents: true } });
    expect(contact.consentStatus).toBe('REVOKED');
    expect(contact.consentEvents.map((e) => [e.status, e.source])).toEqual([['REVOKED', source]]);
    const conv = await env.t.prisma.conversation.findFirstOrThrow({ include: { events: true } });
    expect(conv.events.some((e) => e.type === 'CONSENT_CHANGED')).toBe(true);
    // confirmación automática dentro de la ventana
    const confirm = await env.t.prisma.message.findFirstOrThrow({ where: { direction: 'OUTBOUND' } });
    expect(confirm).toMatchObject({ kind: 'AUTO_REPLY', status: 'SENT' });
    expect(confirm.body).toMatch(/Te hemos dado de baja de las promociones/);
    expect(env.sim.sent.at(-1)!.body.text.body).toBe(confirm.body);
    expect(env.domain.find((d) => d.event === 'inbound.message')!.payload.optedOut).toBe(true);
    expect(env.domain.some((d) => d.event === 'contact.opted_out')).toBe(true);
  }

  it('botón «No recibir más» con payload OPT_OUT (tipo button)', async () => {
    await env.sim.sendInbound({ from: FROM, type: 'button', button: { text: 'No recibir más', payload: 'OPT_OUT' } });
    await expectOptedOut('WHATSAPP_BUTTON');
  });

  it('interactive con id OPT_OUT', async () => {
    await env.sim.sendInbound({ from: FROM, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'OPT_OUT', title: 'No recibir más' } } });
    await expectOptedOut('WHATSAPP_BUTTON');
  });

  it.each(['BAJA', 'Stop', ' no quiero recibir. ', 'Darme de baja', 'NO QUIERO RECIBIR MÁS'])('palabra clave «%s»', async (kw) => {
    await env.sim.sendInbound({ from: FROM, type: 'text', text: { body: kw } });
    const c = await env.t.prisma.contact.findFirstOrThrow({ include: { consentEvents: true } });
    expect(c.consentStatus).toBe('REVOKED');
    expect(c.consentEvents[0]!.source).toBe('WHATSAPP_KEYWORD');
  });

  it('una frase que solo contiene la palabra no es baja; BAJA dentro de un texto largo tampoco', async () => {
    await env.sim.sendInbound({ from: FROM, type: 'text', text: { body: 'Me han dado de baja el pedido, ¿podéis revisarlo?' } });
    await env.sim.sendInbound({ from: FROM, type: 'text', text: { body: 'stop and go' }, name: 'X' });
    expect((await env.t.prisma.contact.findFirstOrThrow()).consentStatus).toBe('UNKNOWN');
    expect(await env.t.prisma.message.count({ where: { direction: 'OUTBOUND' } })).toBe(0);
  });

  it('el webhook repetido de una baja no duplica ni confirmaciones ni eventos de consentimiento', async () => {
    await env.sim.sendInbound({ from: FROM, type: 'text', text: { body: 'BAJA' }, id: 'wamid.BAJA1', repeat: 3 });
    expect(await env.t.prisma.consentEvent.count()).toBe(1);
    expect(await env.t.prisma.message.count({ where: { direction: 'OUTBOUND' } })).toBe(1);
  });

  it('131050: Meta indica que el usuario paró el marketing → REVOKED con origen META_ERROR_131050', async () => {
    const { conversation, contact } = await seedConversation(env.t);
    const tpl = await seedTemplate(env.t, { header: false });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, { 'body.1': 'x', 'button.0': 'y' });
    await env.sim.sendStatus({ wamid: m.wamid!, status: 'failed', errorCode: 131050 });
    const c = await env.t.prisma.contact.findUniqueOrThrow({ where: { id: contact.id }, include: { consentEvents: true } });
    expect(c.consentStatus).toBe('REVOKED');
    expect(c.consentEvents[0]).toMatchObject({ source: 'META_ERROR_131050', messageId: m.id });
    // y ya no se le puede enviar marketing
    await expect(messaging.sendTemplate(conversation.id, tpl.id, { 'body.1': 'x', 'button.0': 'y' })).rejects.toMatchObject({ status: 409 });
  });

  it('131050 recibido en la respuesta del envío (síncrono) también da de baja', async () => {
    const { conversation, contact } = await seedConversation(env.t);
    const tpl = await seedTemplate(env.t, { header: false });
    env.sim.failNext({ code: 131050, path: 'messages' });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, { 'body.1': 'x', 'button.0': 'y' });
    expect(m.status).toBe('FAILED');
    expect((await env.t.prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).consentStatus).toBe('REVOKED');
  });
});

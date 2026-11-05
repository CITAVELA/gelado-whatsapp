import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedConversation, type WaTestEnv } from './meta-simulator/harness';
import { QUEUES } from '../src/modules/jobs/jobs.service';
import { WebhookFieldRouter } from '../src/modules/webhooks/webhook-field-router';
import { MessagingService } from '../src/modules/whatsapp/messaging.service';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});

const FROM = '34600111222';
const text = (body: string, extra: Record<string, unknown> = {}) => ({ from: FROM, type: 'text', text: { body }, ...extra });

describe('S1 · Webhook · verificación y firma (prueba 1)', () => {
  it('GET con token correcto devuelve el challenge en texto plano; con token malo, 403', async () => {
    const ok = await env.t.http.get('/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '12345' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('12345');
    expect(ok.headers['content-type']).toMatch(/text\/plain/);
    const bad = await env.t.http.get('/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': '1' });
    expect(bad.status).toBe(403);
    const noMode = await env.t.http.get('/webhooks/whatsapp').query({ 'hub.verify_token': 'test-verify-token', 'hub.challenge': '1' });
    expect(noMode.status).toBe(403);
  });

  it('firma válida → 200, mensaje guardado y encolado; no hace falta sesión ni CSRF', async () => {
    expect(await env.sim.sendInbound(text('Hola, ¿tenéis tinte?'))).toBe(200);
    const ev = await env.t.prisma.webhookEvent.findMany();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ signatureValid: true, field: 'messages', processedAt: expect.any(Date), attempts: 1, error: null });
    expect(await env.t.prisma.message.count({ where: { direction: 'INBOUND' } })).toBe(1);
  });

  it('firma inválida o ausente → 401, nada se procesa ni se encola', async () => {
    const payload = env.sim.inboundPayload(text('hola'));
    expect(await env.sim.postWebhook(payload, { signature: 'sha256=' + '0'.repeat(64) })).toBe(401);
    expect(await env.sim.postWebhook(payload, { signature: null })).toBe(401);
    expect(await env.sim.postWebhook(payload, { signature: 'md5=abc' })).toBe(401);
    expect(await env.t.prisma.message.count()).toBe(0);
    expect(await env.t.prisma.contact.count()).toBe(0);
    const ev = await env.t.prisma.webhookEvent.findMany();
    expect(ev.every((e) => e.signatureValid === false && e.processedAt === null)).toBe(true);
  });

  it('firma calculada con otro secreto → 401', async () => {
    const body = JSON.stringify(env.sim.inboundPayload(text('hola')));
    const { createHmac } = await import('node:crypto');
    const sig = 'sha256=' + createHmac('sha256', 'otro-secreto').update(body).digest('hex');
    const r = await fetch(env.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body });
    expect(r.status).toBe(401);
  });

  it('webhook duplicado no duplica mensajes ni eventos', async () => {
    await env.sim.sendInbound(text('Hola', { id: 'wamid.DUP1', repeat: 3 }));
    expect(await env.t.prisma.message.count({ where: { wamid: 'wamid.DUP1' } })).toBe(1);
    expect(await env.t.prisma.webhookEvent.count({ where: { dedupeKey: 'msg:wamid.DUP1' } })).toBe(1);
    const conv = await env.t.prisma.conversation.findFirstOrThrow();
    expect(conv.unreadCount).toBe(1);
  });

  it('cambios de otro phone_number_id se ignoran', async () => {
    const payload = env.sim.inboundPayload(text('hola'));
    payload.entry[0].changes[0].value.metadata.phone_number_id = '999';
    expect(await env.sim.postWebhook(payload)).toBe(200);
    expect(await env.t.prisma.webhookEvent.count()).toBe(0);
    expect(await env.t.prisma.message.count()).toBe(0);
  });

  it('los campos de plantillas, calidad y cuenta se reparten por el enrutador (con sus eventos)', async () => {
    const router = env.t.app.get(WebhookFieldRouter);
    const got: Array<{ field: string; value: any }> = [];
    for (const f of ['message_template_status_update', 'message_template_quality_update', 'template_category_update', 'phone_number_quality_update', 'account_update']) {
      router.on(f, 'test', async (value) => void got.push({ field: f, value }));
    }
    await env.sim.sendTemplateStatus({ event: 'APPROVED', templateId: 111, name: 'campana_imagen' });
    await env.sim.sendTemplateStatus({ event: 'REJECTED', templateId: 112, name: 'otra', reason: 'INVALID_FORMAT' });
    await env.sim.sendTemplateQuality({ templateId: 111, name: 'campana_imagen', previous: 'GREEN', next: 'YELLOW' });
    await env.sim.sendTemplateCategory({ templateId: 111, name: 'campana_imagen', previous: 'UTILITY', next: 'MARKETING' });
    await env.sim.sendPhoneQuality({ event: 'DOWNGRADE', currentLimit: 'TIER_250' });
    await env.sim.sendAccountUpdate({ event: 'ACCOUNT_RESTRICTION', restriction_info: [{ restriction_type: 'RESTRICTED_BIZ_INITIATED_MESSAGING' }] });
    expect(got.map((g) => g.field)).toEqual([
      'message_template_status_update', 'message_template_status_update', 'message_template_quality_update', 'template_category_update', 'phone_number_quality_update', 'account_update',
    ]);
    expect(got[1]!.value).toMatchObject({ event: 'REJECTED', message_template_name: 'otra', reason: 'INVALID_FORMAT' });
    expect(got[4]!.value).toMatchObject({ event: 'DOWNGRADE', current_limit: 'TIER_250' });
    // el mismo cambio repetido no se vuelve a entregar
    await env.sim.postWebhook(env.sim.templateStatusPayload({ event: 'APPROVED', templateId: 111, name: 'campana_imagen' }));
    expect(got).toHaveLength(6);
  });

  it('si el procesado falla, el evento guarda el error y un reintento lo completa', async () => {
    const router = env.t.app.get(WebhookFieldRouter);
    let fail = true;
    router.on('account_update', 'test-fail', async () => {
      if (fail) throw new Error('boom');
    });
    await env.sim.sendAccountUpdate({ event: 'DISABLED_UPDATE' });
    const ev = await env.t.prisma.webhookEvent.findFirstOrThrow({ where: { field: 'account_update' } });
    expect(ev.processedAt).toBeNull();
    expect(ev.error).toBe('boom');
    expect(env.t.jobs.inlineErrors).toHaveLength(1);
    fail = false;
    await env.t.jobs.runInline(QUEUES.WA_INBOUND, { eventId: ev.id });
    const after = await env.t.prisma.webhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
    expect(after.processedAt).not.toBeNull();
    expect(after.error).toBeNull();
    expect(after.attempts).toBe(2);
  });
});

describe('S1 · Mensajes entrantes · contacto y conversación', () => {
  it('crea contacto y conversación, abre la ventana de 24 h y emite por WebSocket y por eventos internos', async () => {
    await env.sim.sendInbound(text('Buenas', { name: 'Gines Peluqueros' }));
    const contact = await env.t.prisma.contact.findFirstOrThrow();
    expect(contact).toMatchObject({ phoneE164: '+' + FROM, waId: FROM, profileName: 'Gines Peluqueros', firstName: null, consentStatus: 'UNKNOWN' });
    const conv = await env.t.prisma.conversation.findFirstOrThrow();
    expect(conv).toMatchObject({ status: 'OPEN', unreadCount: 1, lastMessagePreview: 'Buenas', lastMessageKind: 'TEXT', lastMessageDirection: 'INBOUND' });
    expect(conv.windowExpiresAt!.getTime() - conv.lastInboundAt!.getTime()).toBe(24 * 3600_000);
    const events = env.realtime.emitted.map((e) => e.event);
    expect(events).toContain('message.created');
    expect(events).toContain('conversation.updated');
    const created = env.realtime.emitted.find((e) => e.event === 'message.created')!.payload as any;
    expect(created).toMatchObject({ notify: true, message: { direction: 'INBOUND', body: 'Buenas', status: 'RECEIVED' } });
    const dom = env.domain.find((d) => d.event === 'inbound.message')!.payload;
    expect(dom).toMatchObject({ kind: 'TEXT', text: 'Buenas', optedOut: false, reopened: false, contactId: contact.id });
  });

  it('no pisa firstName al actualizar el nombre de perfil; reutiliza el contacto importado por teléfono', async () => {
    const { contact } = await seedConversation(env.t, { firstName: 'Ginés' });
    await env.t.prisma.contact.update({ where: { id: contact.id }, data: { waId: null } });
    await env.sim.sendInbound(text('Hola', { name: 'Nombre Perfil' }));
    expect(await env.t.prisma.contact.count()).toBe(1);
    const c = await env.t.prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(c).toMatchObject({ firstName: 'Ginés', profileName: 'Nombre Perfil', waId: FROM });
    expect(await env.t.prisma.conversation.count()).toBe(1);
  });

  it('un contacto borrado lógicamente reaparece al escribir', async () => {
    const { contact } = await seedConversation(env.t);
    await env.t.prisma.contact.update({ where: { id: contact.id }, data: { deletedAt: new Date() } });
    await env.sim.sendInbound(text('Hola'));
    expect((await env.t.prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).deletedAt).toBeNull();
  });

  it('DONE → OPEN con evento REOPENED; SNOOZED → OPEN con evento WOKE_UP y snoozedUntil nulo', async () => {
    const { conversation } = await seedConversation(env.t);
    await env.t.prisma.conversation.update({ where: { id: conversation.id }, data: { status: 'DONE' } });
    await env.sim.sendInbound(text('Hola otra vez'));
    let c = await env.t.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(c.status).toBe('OPEN');
    expect(env.domain.find((d) => d.event === 'inbound.message')!.payload.reopened).toBe(true);
    await env.t.prisma.conversation.update({ where: { id: conversation.id }, data: { status: 'SNOOZED', snoozedUntil: new Date(Date.now() + 3600_000) } });
    await env.sim.sendInbound(text('¿Hay novedades?'));
    c = await env.t.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(c).toMatchObject({ status: 'OPEN', snoozedUntil: null, unreadCount: 2 });
    const evs = await env.t.prisma.conversationEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(evs.map((e) => [e.type, (e.data as any).reason])).toEqual([['REOPENED', 'inbound'], ['WOKE_UP', 'inbound']]);
    expect(env.realtime.emitted.some((e) => e.event === 'event.created')).toBe(true);
  });

  it('respuesta con cita guarda contextWamid', async () => {
    await env.sim.sendInbound(text('Sí, gracias', { context: { id: 'wamid.ORIGINAL', from: '34617498222' } }));
    expect((await env.t.prisma.message.findFirstOrThrow()).contextWamid).toBe('wamid.ORIGINAL');
  });
});

describe('S1 · Estados de mensajes salientes (pruebas 1 y 10)', () => {
  async function sendOne() {
    const { conversation } = await seedConversation(env.t);
    const m = await env.t.app.get(MessagingService).sendText(conversation.id, 'Hola Ginés');
    expect(m.status).toBe('SENT');
    return { conversation, m };
  }

  it('el envío guarda el wamid y SENT al momento; los estados avanzan y guardan precio', async () => {
    const { m } = await sendOne();
    const wamid = m.wamid!;
    expect(env.sim.sent).toHaveLength(1);
    expect(env.sim.sent[0]!.body).toMatchObject({ type: 'text', to: FROM, text: { body: 'Hola Ginés' } });

    await env.sim.sendStatus({ wamid, status: 'delivered', pricing: { billable: true, pricing_model: 'PMP', category: 'marketing', type: 'regular' } });
    let row = await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ status: 'DELIVERED', pricingCategory: 'marketing', billable: true });
    expect(row.deliveredAt).not.toBeNull();

    await env.sim.sendStatus({ wamid, status: 'read' });
    row = await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.status).toBe('READ');
    expect(row.readAt).not.toBeNull();
    // se conserva el precio del estado anterior si el nuevo no lo trae
    expect(row.pricingCategory).toBe('service');
    const evs = env.domain.filter((d) => d.event === 'message.status').map((d) => d.payload.status);
    expect(evs).toEqual(['SENT', 'DELIVERED', 'READ']);
    expect(env.realtime.emitted.filter((e) => e.event === 'message.status').length).toBeGreaterThanOrEqual(3);
  });

  it('un estado que llega tarde no hace retroceder; failed siempre gana; un estado posterior no pisa failed', async () => {
    const { m } = await sendOne();
    await env.sim.sendStatus({ wamid: m.wamid!, status: 'read' });
    await env.sim.sendStatus({ wamid: m.wamid!, status: 'delivered' });
    await env.sim.sendStatus({ wamid: m.wamid!, status: 'sent' });
    let row = await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.status).toBe('READ');
    expect(row.deliveredAt).not.toBeNull(); // la fecha tardía se completa sin retroceder
    await env.sim.sendStatus({ wamid: m.wamid!, status: 'failed', errorCode: 131049 });
    row = await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ status: 'FAILED', errorCode: 131049 });
    expect(row.errorTitle).toMatch(/Meta no lo entregó/);
    await env.sim.sendStatus({ wamid: m.wamid!, status: 'read' });
    expect((await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('FAILED');
  });

  it('estado antes que la respuesta del envío: el evento queda sin procesar y se completa al reintentar', async () => {
    const { conversation } = await seedConversation(env.t);
    const messaging = env.t.app.get(MessagingService);
    env.sim.sendDelayMs = 400;
    const sending = messaging.sendText(conversation.id, 'Hola');
    // esperar a que Meta «reciba» el envío y adelantarse con el estado
    for (let i = 0; i < 100 && env.sim.sent.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    const wamid = env.sim.sent[0]!.id;
    await env.sim.sendStatus({ wamid, status: 'delivered' });
    const ev = await env.t.prisma.webhookEvent.findFirstOrThrow({ where: { dedupeKey: `st:${wamid}:delivered` } });
    expect(ev.processedAt).toBeNull();
    expect(ev.error).toMatch(/antes de guardar/);
    await sending;
    // reintento con espera (en producción lo hace pg-boss): ahora el wamid existe
    await env.t.jobs.runInline(QUEUES.WA_INBOUND, { eventId: ev.id });
    const m = await env.t.prisma.message.findFirstOrThrow({ where: { wamid } });
    expect(m.status).toBe('DELIVERED');
    expect((await env.t.prisma.webhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).processedAt).not.toBeNull();
  });

  it('precio (category y billable) se guarda para el cálculo de coste (prueba 10)', async () => {
    const { m } = await sendOne();
    await env.sim.sendStatus({ wamid: m.wamid!, status: 'sent', pricing: { billable: false, pricing_model: 'PMP', category: 'service', type: 'free_customer_service' } });
    const row = await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ pricingCategory: 'service', billable: false });
  });
});

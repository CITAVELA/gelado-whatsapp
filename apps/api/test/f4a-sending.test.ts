/**
 * F4a · Regresión de los defectos de S9 en el envío saliente:
 *  #2 baja recomprobada en processSend y retry() con las reglas de sendTemplate (+ campaña RUNNING)
 *  #4 doble envío (biz_opaque_callback_data, «en curso», estado incierto)
 *  #5 PENDING huérfanos reencolados por la tarea de cada minuto
 *  #6 se guarda si el error era reintentable
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedConversation, seedTemplate, type WaTestEnv } from './meta-simulator/harness';
import { MessagingService, REVOKED_MARKETING_MESSAGE, UNKNOWN_SEND_STATE_TITLE } from '../src/modules/whatsapp/messaging.service';
import { MessageNotifier } from '../src/modules/whatsapp/message-notifier.service';
import { ConsentService } from '../src/modules/contacts/consent.service';

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

const TPL_PARAMS = { 'body.1': 'Ginés', 'button.0': 'x' };
const row = (id: string) => env.t.prisma.message.findUniqueOrThrow({ where: { id } });
const templatesSent = () => env.sim.sent.filter((s) => s.body?.type === 'template');
async function newCampaign(templateId: string, status: 'RUNNING' | 'PAUSED' | 'CANCELLED' = 'RUNNING') {
  const user = await env.t.prisma.user.findFirstOrThrow();
  return env.t.prisma.campaign.create({ data: { name: 'C', templateId, variableMapping: {}, audience: {}, createdById: user.id, status } });
}
/** Agota los 4 intentos de un envío con error temporal (130429) para dejarlo FAILED reintentable. */
async function exhaust(id: string) {
  for (let i = 0; i < 3; i++) await messaging.processSend(id).catch(() => undefined);
  return row(id);
}

describe('F4a · #2 baja y reglas al reintentar', () => {
  it('reintentar un marketing fallido tras la baja → 409 y no se envía', async () => {
    const { conversation, contact } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    env.sim.failNext({ code: 130429, count: 10, path: 'messages' });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, TPL_PARAMS);
    expect((await exhaust(m.id)).status).toBe('FAILED');
    env.sim.reset();
    await env.t.app.get(ConsentService).setConsent(contact.id, 'REVOKED', 'WHATSAPP_KEYWORD');
    await expect(messaging.retry(m.id)).rejects.toMatchObject({ status: 409, response: { message: REVOKED_MARKETING_MESSAGE } });
    expect(templatesSent()).toHaveLength(0);
    expect((await row(m.id)).status).toBe('FAILED');
  });

  it('un wa-send reintentado tras la baja no envía el marketing: FAILED con el motivo en español', async () => {
    const { conversation, contact } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    env.sim.failNext({ code: 130429, count: 1, path: 'messages' });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, TPL_PARAMS);
    expect(m.status).toBe('PENDING'); // quedó para reintento
    await env.t.app.get(ConsentService).setConsent(contact.id, 'REVOKED', 'WHATSAPP_KEYWORD');
    await messaging.processSend(m.id); // reintento de pg-boss
    const after = await row(m.id);
    expect(after).toMatchObject({ status: 'FAILED', errorRetryable: false, errorTitle: REVOKED_MARKETING_MESSAGE });
    expect(templatesSent()).toHaveLength(0);
    // y desde la interfaz no se ofrece reintentar
    expect((await env.t.app.get(MessageNotifier).messageDto(m.id))!.retryable).toBe(false);
  });

  it('una plantilla de utilidad sí se envía a quien se dio de baja del marketing', async () => {
    const { conversation, contact } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false, category: 'UTILITY' });
    env.sim.failNext({ code: 130429, count: 1, path: 'messages' });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, TPL_PARAMS);
    await env.t.app.get(ConsentService).setConsent(contact.id, 'REVOKED', 'WHATSAPP_KEYWORD');
    await messaging.processSend(m.id);
    expect((await row(m.id)).status).toBe('SENT');
  });

  it('retry(): plantilla ya no aprobada y ventana cerrada en mensajes que no son plantilla → 409', async () => {
    const { conversation } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    env.sim.failNext({ code: 130429, count: 10, path: 'messages' });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, TPL_PARAMS);
    await exhaust(m.id);
    env.sim.reset();
    await env.t.prisma.template.update({ where: { id: tpl.id }, data: { status: 'PAUSED' } });
    await expect(messaging.retry(m.id)).rejects.toMatchObject({ status: 409, response: { message: expect.stringMatching(/no está aprobada/) } });
    await env.t.prisma.template.update({ where: { id: tpl.id }, data: { status: 'APPROVED' } });
    expect((await messaging.retry(m.id)).status).toBe('SENT'); // con la ventana cerrada, una plantilla sí

    const open = await seedConversation(env.t, { phone: '34600333444' });
    env.sim.failNext({ code: 130429, count: 10, path: 'messages' });
    const t = await messaging.sendText(open.conversation.id, 'Hola');
    await exhaust(t.id);
    env.sim.reset();
    await env.t.prisma.conversation.update({ where: { id: open.conversation.id }, data: { windowExpiresAt: new Date(Date.now() - 1000) } });
    await expect(messaging.retry(t.id)).rejects.toMatchObject({ status: 409, response: { message: expect.stringMatching(/ventana de 24 h/) } });
  });

  it('retry() de un mensaje de campaña solo si la campaña está RUNNING', async () => {
    const { conversation } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    const camp = await newCampaign(tpl.id);
    env.sim.failNext({ code: 130429, count: 10, path: 'messages' });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, TPL_PARAMS, { campaignId: camp.id });
    await exhaust(m.id);
    env.sim.reset();
    for (const status of ['PAUSED', 'CANCELLED'] as const) {
      await env.t.prisma.campaign.update({ where: { id: camp.id }, data: { status } });
      await expect(messaging.retry(m.id)).rejects.toMatchObject({ status: 409, response: { message: expect.stringMatching(/campaña/) } });
    }
    expect(templatesSent()).toHaveLength(0);
    await env.t.prisma.campaign.update({ where: { id: camp.id }, data: { status: 'RUNNING' } });
    expect((await messaging.retry(m.id)).status).toBe('SENT');
  });

  it('dos reintentos seguidos del mismo mensaje no lo envían dos veces', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.failNext({ code: 130429, count: 10, path: 'messages' });
    const m = await messaging.sendText(conversation.id, 'Hola');
    await exhaust(m.id);
    env.sim.reset();
    const results = await Promise.allSettled([messaging.retry(m.id), messaging.retry(m.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(env.sim.sent).toHaveLength(1);
  });
});

describe('F4a · #6 error reintentable guardado', () => {
  it('un 5xx agotado con código de Graph desconocido queda FAILED y se puede reintentar a mano', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.failNext({ code: 131000, httpStatus: 500, count: 10, path: 'messages' });
    const m = await messaging.sendText(conversation.id, 'Hola');
    const f = await exhaust(m.id);
    expect(f).toMatchObject({ status: 'FAILED', errorCode: 131000, errorRetryable: true });
    expect((await env.t.app.get(MessageNotifier).messageDto(m.id))!.retryable).toBe(true);
    env.sim.reset();
    const again = await messaging.retry(m.id);
    expect(again.status).toBe('SENT');
    expect(again.errorRetryable).toBeNull();
  });

  it('un error definitivo guarda errorRetryable=false y no se ofrece reintentar', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.failNext({ code: 132000, path: 'messages' });
    const m = await messaging.sendText(conversation.id, 'Hola');
    expect(m).toMatchObject({ status: 'FAILED', errorRetryable: false });
    expect((await env.t.app.get(MessageNotifier).messageDto(m.id))!.retryable).toBe(false);
  });

  it('un estado failed del webhook también guarda si es reintentable', async () => {
    const { conversation } = await seedConversation(env.t);
    const m = await messaging.sendText(conversation.id, 'Hola');
    await env.sim.sendStatus({ wamid: (await row(m.id)).wamid!, status: 'failed', errorCode: 131026 });
    expect(await row(m.id)).toMatchObject({ status: 'FAILED', errorCode: 131026, errorRetryable: false });
  });
});

describe('F4a · #4 doble envío', () => {
  it('cada envío lleva biz_opaque_callback_data = id del mensaje', async () => {
    const { conversation } = await seedConversation(env.t);
    const m = await messaging.sendText(conversation.id, 'Hola');
    expect(env.sim.sent[0]!.body.biz_opaque_callback_data).toBe(m.id);
  });

  it('un estado con wamid desconocido se enlaza por biz_opaque_callback_data (respuesta de Meta perdida)', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.dropResponses = 1;
    const m = await messaging.sendText(conversation.id, 'Hola'); // Meta lo recibe, la app no ve la respuesta
    expect(env.sim.sent).toHaveLength(1);
    expect(await row(m.id)).toMatchObject({ status: 'PENDING', wamid: null, sendState: 'UNCERTAIN' });
    const wamid = env.sim.sent[0]!.id;
    await env.sim.sendStatus({ wamid, status: 'delivered' });
    expect(await row(m.id)).toMatchObject({ wamid, status: 'DELIVERED', sendState: 'UNCERTAIN' });
    // el reintento de pg-boss ya no reenvía: tiene wamid
    await messaging.processSend(m.id);
    expect(env.sim.sent).toHaveLength(1);
  });

  it('mensaje de campaña con estado incierto: no se reenvía; FAILED «Estado de envío desconocido» y reintento manual', async () => {
    const { conversation } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    const camp = await newCampaign(tpl.id);
    env.sim.dropResponses = 1;
    const m = await messaging.sendTemplate(conversation.id, tpl.id, TPL_PARAMS, { campaignId: camp.id });
    expect(templatesSent()).toHaveLength(1);
    expect((await row(m.id)).sendState).toBe('UNCERTAIN');
    await messaging.processSend(m.id); // el reintento de pg-boss
    expect(templatesSent()).toHaveLength(1); // NO se duplica
    expect(await row(m.id)).toMatchObject({ status: 'FAILED', errorTitle: UNKNOWN_SEND_STATE_TITLE, errorRetryable: true, sendState: null });
    expect((await env.t.app.get(MessageNotifier).messageDto(m.id))!.retryable).toBe(true);
    // si en realidad había salido, su estado lo corrige
    await env.sim.sendStatus({ wamid: env.sim.sent[0]!.id, status: 'delivered' });
    expect(await row(m.id)).toMatchObject({ status: 'DELIVERED', wamid: env.sim.sent[0]!.id, errorTitle: null });
  });

  it('mensaje de campaña con estado incierto y sin estado de Meta: el reintento manual lo envía', async () => {
    const { conversation } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    const camp = await newCampaign(tpl.id);
    env.sim.dropResponses = 1;
    const m = await messaging.sendTemplate(conversation.id, tpl.id, TPL_PARAMS, { campaignId: camp.id });
    await messaging.processSend(m.id);
    expect((await row(m.id)).status).toBe('FAILED');
    const again = await messaging.retry(m.id);
    expect(again.status).toBe('SENT');
    expect(templatesSent()).toHaveLength(2); // decisión de la persona
  });

  it('mensaje del chat con estado incierto: se reenvía (decisión documentada: un duplicado ocasional es visible y barato)', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.dropResponses = 1;
    const m = await messaging.sendText(conversation.id, 'Hola');
    expect((await row(m.id)).sendState).toBe('UNCERTAIN');
    await messaging.processSend(m.id);
    expect(env.sim.sent).toHaveLength(2);
    expect(await row(m.id)).toMatchObject({ status: 'SENT', sendState: null, sendStartedAt: null });
  });

  it('un envío caído a mitad («en curso» viejo) se trata como incierto', async () => {
    const { conversation } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    const camp = await newCampaign(tpl.id);
    env.sim.failNext({ code: 130429, count: 1, path: 'messages' });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, TPL_PARAMS, { campaignId: camp.id });
    // simula que el proceso murió tras marcar SENDING hace 5 minutos
    await env.t.prisma.message.update({ where: { id: m.id }, data: { sendState: 'SENDING', sendStartedAt: new Date(Date.now() - 5 * 60_000) } });
    await messaging.processSend(m.id);
    expect(await row(m.id)).toMatchObject({ status: 'FAILED', errorTitle: UNKNOWN_SEND_STATE_TITLE });
    expect(templatesSent()).toHaveLength(0);
  });

  it('dos trabajos a la vez para el mismo mensaje envían una sola vez', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.failNext({ code: 130429, count: 1, path: 'messages' });
    const m = await messaging.sendText(conversation.id, 'Hola');
    env.sim.sendDelayMs = 300;
    await Promise.all([messaging.processSend(m.id), messaging.processSend(m.id)]);
    expect(env.sim.sent).toHaveLength(1);
    expect((await row(m.id)).status).toBe('SENT');
  });

  it('un error HTTP claro de Meta (4xx/5xx con respuesta) no deja el envío incierto', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.failNext({ code: 130429, count: 1, path: 'messages' });
    const m = await messaging.sendText(conversation.id, 'Hola');
    expect(await row(m.id)).toMatchObject({ status: 'PENDING', sendState: null, sendStartedAt: null });
  });
});

describe('F4a · #5 PENDING huérfanos', () => {
  it('la tarea de cada minuto reencola los PENDING de más de 5 minutos y no toca los recientes', async () => {
    const { conversation } = await seedConversation(env.t);
    const mk = (ageMin: number) =>
      env.t.prisma.message.create({
        data: { conversationId: conversation.id, direction: 'OUTBOUND', kind: 'TEXT', body: `hace ${ageMin} min`, status: 'PENDING', createdAt: new Date(Date.now() - ageMin * 60_000) },
      });
    const old = await mk(10);
    const fresh = await mk(1);
    expect(env.t.jobs.hasHandler('cron-every-minute')).toBe(true);
    await env.t.jobs.runCronsFor(new Date());
    expect(await row(old.id)).toMatchObject({ status: 'SENT' });
    expect(await row(fresh.id)).toMatchObject({ status: 'PENDING' });
    expect(env.sim.sent).toHaveLength(1);
    expect(env.sim.sent[0]!.body.text.body).toBe('hace 10 min');
  });

  it('un orfano de campaña con marketing y baja se descarta (FAILED) en vez de enviarse', async () => {
    const { conversation, contact } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    const m = await env.t.prisma.message.create({
      data: { conversationId: conversation.id, direction: 'OUTBOUND', kind: 'TEMPLATE', templateId: tpl.id, templateParams: TPL_PARAMS, body: 'x', status: 'PENDING', createdAt: new Date(Date.now() - 20 * 60_000) },
    });
    await env.t.prisma.contact.update({ where: { id: contact.id }, data: { consentStatus: 'REVOKED' } });
    expect(await messaging.requeueOrphans()).toBe(1);
    expect(await row(m.id)).toMatchObject({ status: 'FAILED', errorRetryable: false });
    expect(env.sim.sent).toHaveLength(0);
  });
});

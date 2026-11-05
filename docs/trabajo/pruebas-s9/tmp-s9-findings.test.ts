/**
 * S9 · Pruebas TEMPORALES de confirmación de hallazgos (no se integran).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { editorToComponents, hasOptOutButton, optOutButtonIndex } from '@gelado/shared';
import { createWaTestEnv, seedConversation, seedTemplate, type WaTestEnv } from './meta-simulator/harness';
import { MessagingService } from '../src/modules/whatsapp/messaging.service';
import { ConsentService } from '../src/modules/contacts/consent.service';
import { WebhookIngestService } from '../src/modules/webhooks/webhook-ingest.service';
import { QUEUES } from '../src/modules/jobs/jobs.service';

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

describe('S9 · tmp', () => {
  it('H1: «Ver rebajas» cuenta como botón de baja; el editor no añade «No recibir más»', () => {
    const comps = editorToComponents({
      displayName: 'Rebajas', name: 'rebajas_nov', category: 'MARKETING', language: 'es',
      header: { format: 'NONE' }, body: 'Llegan las rebajas', bodyExamples: [], buttons: [{ type: 'QUICK_REPLY', text: 'Ver rebajas' }], addOptOutButton: true,
    } as any);
    const btns = comps.find((c) => c.type === 'BUTTONS')!.buttons!.map((b) => b.text);
    expect(btns).toEqual(['Ver rebajas']); // sin «No recibir más»
    expect(hasOptOutButton(comps)).toBe(true); // se considera apta para campañas
    expect(optOutButtonIndex(comps)).toBe(0); // el payload OPT_OUT va en «Ver rebajas»
  });

  it('H1b: pulsar «Ver rebajas» (payload OPT_OUT) da de baja al contacto', async () => {
    const { contact } = await seedConversation(env.t);
    await env.sim.sendInbound({ from: '34600111222', type: 'button', button: { text: 'Ver rebajas', payload: 'OPT_OUT' } });
    const c = await env.t.prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(c.consentStatus).toBe('REVOKED');
  });

  it('H2: reintentar un marketing fallido tras la baja lo envía a un contacto REVOKED', async () => {
    const { conversation, contact } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    env.sim.failNext({ code: 130429, count: 10, path: 'messages' });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, { 'body.1': 'Ginés', 'button.0': 'x' });
    // inline: 1.er intento falla (5xx) → relanza; simulamos los reintentos de pg-boss hasta agotar
    for (let i = 0; i < 3; i++) await messaging.processSend(m.id).catch(() => undefined);
    expect((await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('FAILED');
    env.sim.reset();
    await env.t.app.get(ConsentService).setConsent(contact.id, 'REVOKED', 'WHATSAPP_KEYWORD');
    const r = await messaging.retry(m.id);
    expect(r.status).toBe('SENT');
    expect(env.sim.sent.filter((s) => s.body?.type === 'template')).toHaveLength(1);
  });

  it('H3: un wa-send reintentado tras la baja envía igualmente el marketing (processSend no comprueba el consentimiento)', async () => {
    const { conversation, contact } = await seedConversation(env.t, { windowOpen: false });
    const tpl = await seedTemplate(env.t, { header: false });
    env.sim.failNext({ code: 130429, count: 1, path: 'messages' });
    const m = await messaging.sendTemplate(conversation.id, tpl.id, { 'body.1': 'Ginés', 'button.0': 'x' });
    expect(m.status).toBe('PENDING'); // quedó para reintento
    await env.t.app.get(ConsentService).setConsent(contact.id, 'REVOKED', 'WHATSAPP_KEYWORD');
    await messaging.processSend(m.id); // reintento de pg-boss
    const after = await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe('SENT');
  });

  it('H4: un segundo FLAGGED (tras UNFLAGGED) con el mismo valor se descarta como duplicado', async () => {
    const ingest = env.t.app.get(WebhookIngestService);
    const value = { display_phone_number: '34617498222', event: 'FLAGGED', current_limit: 'TIER_2K' };
    const mk = (v: any, time: number) => ({ object: 'whatsapp_business_account', entry: [{ id: '24936790469294569', time, changes: [{ field: 'phone_number_quality_update', value: v }] }] });
    const a = await ingest.ingest(mk(value, 1000));
    await ingest.ingest(mk({ ...value, event: 'UNFLAGGED' }, 2000));
    const b = await ingest.ingest(mk(value, 3000)); // semanas después, mismo contenido
    expect(a).toMatchObject({ events: 1, duplicates: 0 });
    expect(b).toMatchObject({ events: 0, duplicates: 1 });
  });

  it('H6: un 5xx agotado con código de Graph desconocido queda FAILED pero no se puede reintentar a mano', async () => {
    const { conversation } = await seedConversation(env.t);
    env.sim.failNext({ code: 131000, httpStatus: 500, count: 10, path: 'messages' });
    const m = await messaging.sendText(conversation.id, 'Hola');
    for (let i = 0; i < 3; i++) await messaging.processSend(m.id).catch(() => undefined);
    const f = await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(f).toMatchObject({ status: 'FAILED', errorCode: 131000 });
    env.sim.reset();
    await expect(messaging.retry(m.id)).rejects.toMatchObject({ status: 409 });
  });

  it('H5: no hay ningún handler de limpieza diaria (cron-daily-cleanup)', () => {
    expect(env.t.jobs.hasHandler(QUEUES.CRON_DAILY)).toBe(false);
  });
});

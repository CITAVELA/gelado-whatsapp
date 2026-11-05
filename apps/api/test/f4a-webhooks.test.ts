/**
 * F4a · Webhook: #3 dedupe con entry.time, M3 rechazos sin saturar la tabla + tope de cuerpo, #20 carrera con posponer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedConversation, type WaTestEnv } from './meta-simulator/harness';
import { WebhookIngestService } from '../src/modules/webhooks/webhook-ingest.service';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});

describe('F4a · #3 dedupe de campos que no son messages', () => {
  const mk = (v: any, time: number) => ({ object: 'whatsapp_business_account', entry: [{ id: '24936790469294569', time, changes: [{ field: 'phone_number_quality_update', value: v }] }] });
  const value = { display_phone_number: '34617498222', event: 'FLAGGED', current_limit: 'TIER_2K' };

  it('FLAGGED → UNFLAGGED → FLAGGED (mismo contenido, otro entry.time) no se descarta', async () => {
    const ingest = env.t.app.get(WebhookIngestService);
    const a = await ingest.ingest(mk(value, 1000));
    await ingest.ingest(mk({ ...value, event: 'UNFLAGGED' }, 2000));
    const b = await ingest.ingest(mk(value, 3000));
    expect(a).toMatchObject({ events: 1, duplicates: 0 });
    expect(b).toMatchObject({ events: 1, duplicates: 0 });
    expect(await env.t.prisma.webhookEvent.count({ where: { field: 'phone_number_quality_update' } })).toBe(3);
  });

  it('Meta reenvía el mismo POST (mismo entry.time) → duplicado', async () => {
    const ingest = env.t.app.get(WebhookIngestService);
    await ingest.ingest(mk(value, 1000));
    expect(await ingest.ingest(mk(value, 1000))).toMatchObject({ events: 0, duplicates: 1 });
  });
});

describe('F4a · M3 webhooks rechazados', () => {
  const body = () => env.sim.inboundPayload({ from: '34600111222', type: 'text', text: { body: 'Hola' } });

  it('muchos POST sin firma o con firma mala: 401 y como mucho una fila de auditoría por minuto', async () => {
    const ingest = env.t.app.get(WebhookIngestService);
    ingest.rejected.lastLoggedAt = 0;
    const before = ingest.rejected.total;
    for (let i = 0; i < 12; i++) {
      expect(await env.sim.postWebhook(body(), { signature: i % 2 ? null : 'sha256=mala' })).toBe(401);
    }
    expect(ingest.rejected.total - before).toBe(12);
    const rows = await env.t.prisma.webhookEvent.findMany({ where: { signatureValid: false } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ rejected: true });
    expect(await env.t.prisma.message.count()).toBe(0);
  });

  it('pasado el minuto se registra otra fila con el recuento', async () => {
    const ingest = env.t.app.get(WebhookIngestService);
    ingest.rejected.lastLoggedAt = 0;
    await env.sim.postWebhook(body(), { signature: null });
    ingest.rejected.lastLoggedAt = Date.now() - 61_000;
    await env.sim.postWebhook(body(), { signature: null });
    expect(await env.t.prisma.webhookEvent.count({ where: { signatureValid: false } })).toBe(2);
  });

  it('cuerpo de más de 1 MB en /webhooks/whatsapp → 413; uno normal firmado sigue funcionando (cuerpo crudo intacto)', async () => {
    const big = JSON.stringify({ object: 'whatsapp_business_account', entry: [], pad: 'x'.repeat(1_200_000) });
    const r = await fetch(env.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': env.sim.sign(big) }, body: big });
    expect(r.status).toBe(413);
    expect(await env.sim.sendInbound({ from: '34600111222', type: 'text', text: { body: 'Hola' } })).toBe(200);
    expect(await env.t.prisma.message.count({ where: { direction: 'INBOUND' } })).toBe(1);
  });

  it('el resto de la API conserva su tope mayor (5 MB)', async () => {
    const payload = JSON.stringify({ a: 'x'.repeat(2_000_000) });
    const r = await fetch(`${env.appUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: payload });
    expect(r.status).not.toBe(413);
  });
});

describe('F4a · #20 carrera posponer/finalizar con mensaje entrante', () => {
  for (const [name, data] of [
    ['pospone', { status: 'SNOOZED', snoozedUntil: new Date(Date.now() + 3600_000) }],
    ['finaliza', { status: 'DONE' }],
  ] as const) {
    it(`si alguien ${name} la conversación mientras entra un mensaje, queda abierta y con no leído`, async () => {
      const { conversation } = await seedConversation(env.t);
      // Transacción de la persona: cambia el estado y tarda en confirmar
      const holder = env.t.prisma.$transaction(
        async (tx) => {
          await tx.conversation.update({ where: { id: conversation.id }, data });
          await new Promise((r) => setTimeout(r, 700));
        },
        { timeout: 15_000 },
      );
      await new Promise((r) => setTimeout(r, 200));
      expect(await env.sim.sendInbound({ from: '34600111222', type: 'text', text: { body: 'Ey, ¿hay stock?' } })).toBe(200);
      await holder;
      const c = await env.t.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
      expect(c).toMatchObject({ status: 'OPEN', snoozedUntil: null, unreadCount: 1 });
      const ev = await env.t.prisma.conversationEvent.findMany({ where: { conversationId: conversation.id } });
      expect(ev.map((e) => e.type)).toEqual([name === 'pospone' ? 'WOKE_UP' : 'REOPENED']);
    });
  }
});

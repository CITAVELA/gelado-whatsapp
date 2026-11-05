/** S11 · Despertar inmediato al encolar (sondeo de seguridad a 30 s) y supervivencia a reinicios. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './utils/app';
import { JobsService, POLLING_SECONDS, QUEUES } from '../src/modules/jobs/jobs.service';

let t: TestApp;
beforeAll(async () => {
  process.env.WORKER_ENABLED = 'true';
  t = await createTestApp({ WORKER_ENABLED: 'true' });

});
afterAll(async () => {
  await t?.close();
  process.env.WORKER_ENABLED = 'false';
});

const evt = (t0: TestApp) => t0.prisma.webhookEvent.create({ data: { signatureValid: true, field: 'account_update', dedupeKey: `s11-${Math.random()}`, payload: { x: 1 } } });

async function waitProcessed(t0: TestApp, id: string, ms: number) {
  const t1 = Date.now();
  while (Date.now() - t1 < ms) {
    const e = await t0.prisma.webhookEvent.findUnique({ where: { id } });
    if (e?.processedAt) return Date.now() - t1;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

describe('S11 · pg-boss sin sondeo rápido', () => {
  it('el sondeo es de 30 s en wa-inbound/wa-send', () => {
    expect(POLLING_SECONDS['wa-inbound']).toBe(30);
    expect(POLLING_SECONDS['wa-send']).toBe(30);
  });

  it('un send a wa-inbound se procesa en < 2 s aunque el sondeo sea de 30 s', async () => {
    const jobs = t.app.get(JobsService);
    expect(jobs.inlineMode).toBe(false);
    await new Promise((r) => setTimeout(r, 2000)); // el worker ya está dormido en su espera de 30 s
    for (let i = 0; i < 3; i++) {
      const e = await evt(t);
      await jobs.send(QUEUES.WA_INBOUND, { eventId: e.id });
      const ms = await waitProcessed(t, e.id, 2000);
      expect(ms, `intento ${i}`).not.toBeNull();
    }
  }, 30_000);

  it('varios trabajos seguidos (ráfaga) se procesan todos sin esperar al sondeo', async () => {
    const jobs = t.app.get(JobsService);
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const e = await evt(t);
      ids.push(e.id);
      await jobs.send(QUEUES.WA_INBOUND, { eventId: e.id });
    }
    for (const id of ids) expect(await waitProcessed(t, id, 5000)).not.toBeNull();
  }, 30_000);

  it('nada se pierde al reiniciar: encolado sin workers se procesa al arrancar la app', async () => {
    const e = await evt(t);
    await t.app.close(); // la app con workers se para
    // Otro proceso (sin workers) deja el trabajo en la cola
    const producer = await createTestApp({ WORKER_ENABLED: 'false' });
    const pj = producer.app.get(JobsService);
    pj.inlineMode = false;
    await pj.send(QUEUES.WA_INBOUND, { eventId: e.id });
    const row = await producer.prisma.webhookEvent.findUnique({ where: { id: e.id } });
    expect(row?.processedAt).toBeNull();
    await producer.app.close();
    await producer.prisma.$disconnect();
    // Arranca de nuevo con workers: el primer sondeo es inmediato
    t = await createTestApp({ WORKER_ENABLED: 'true' });
    expect(await waitProcessed(t, e.id, 8000)).not.toBeNull();
  }, 40_000);

  it('el planificador propio lanza los crons del minuto y los horarios en su hora de Madrid', async () => {
    const jobs = t.app.get(JobsService);
    const calls: string[] = [];
    (jobs as any).handlers.set('cron-every-minute', [{ name: 'a', fn: async () => void calls.push('min') }]);
    (jobs as any).handlers.set('cron-hourly', [{ name: 'b', fn: async () => void calls.push('hour') }]);
    (jobs as any).handlers.set('cron-daily-cleanup', [{ name: 'c', fn: async () => void calls.push('day') }]);
    await jobs.runCronsFor(new Date('2026-01-15T10:07:30Z')); // 11:07 Madrid
    await jobs.runCronsFor(new Date('2026-01-15T10:08:30Z')); // 11:08
    await jobs.runCronsFor(new Date('2026-07-15T01:00:10Z')); // 03:00 Madrid (verano, UTC+2)
    expect(calls).toEqual(['min', 'hour', 'min', 'min', 'day']);
  });
});

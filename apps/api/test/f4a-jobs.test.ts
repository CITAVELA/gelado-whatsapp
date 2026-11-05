/**
 * F4a · Jobs: #16 limpieza diaria (S10 M4), #17 failedLast24h con archivo y crons vencidos tras un tick largo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, type TestApp } from './utils/app';
import { JobsService, QUEUES, dueCrons } from '../src/modules/jobs/jobs.service';
import { CleanupService } from '../src/modules/jobs/cleanup.service';

let t: TestApp;
beforeAll(async () => {
  process.env.WORKER_ENABLED = 'true';
  t = await createTestApp({ WORKER_ENABLED: 'true' });
});
afterAll(async () => {
  await t?.close();
  process.env.WORKER_ENABLED = 'false';
});
beforeEach(async () => t.reset());

const DAY = 24 * 3600 * 1000;
const ago = (d: number) => new Date(Date.now() - d * DAY);

describe('F4a · #16 limpieza diaria', () => {
  it('hay un handler en cron-daily-cleanup (antes no había ninguno)', () => {
    expect(t.app.get(JobsService).hasHandler(QUEUES.CRON_DAILY)).toBe(true);
  });

  it('borra webhooks procesados > 90 d, rechazados > 7 d, sesiones caducadas y tokens usados/caducados > 30 d; conserva lo demás', async () => {
    const wh = (o: { signatureValid?: boolean; receivedAt: Date; processedAt?: Date | null; k: string }) =>
      t.prisma.webhookEvent.create({ data: { signatureValid: o.signatureValid ?? true, field: 'account_update', dedupeKey: o.k, payload: {}, receivedAt: o.receivedAt, processedAt: o.processedAt ?? null } });
    await wh({ k: 'viejo-procesado', receivedAt: ago(100), processedAt: ago(100) });
    await wh({ k: 'reciente-procesado', receivedAt: ago(80), processedAt: ago(80) });
    await wh({ k: 'viejo-sin-procesar', receivedAt: ago(100) }); // no procesado: se conserva para diagnosticar
    await wh({ k: 'rechazado-viejo', signatureValid: false, receivedAt: ago(8) });
    await wh({ k: 'rechazado-reciente', signatureValid: false, receivedAt: ago(2) });

    const u = await createUser(t.prisma, { email: 'limpieza@gelado.test' });
    const ses = (k: string, expiresAt: Date) => t.prisma.session.create({ data: { userId: u.id, tokenHash: k, expiresAt } });
    await ses('s-caducada', ago(1));
    await ses('s-vigente', new Date(Date.now() + DAY));
    const tok = (k: string, o: { expiresAt: Date; usedAt?: Date | null }) => t.prisma.passwordResetToken.create({ data: { userId: u.id, tokenHash: k, expiresAt: o.expiresAt, usedAt: o.usedAt ?? null } });
    await tok('t-usado-viejo', { expiresAt: ago(40), usedAt: ago(45) });
    await tok('t-caducado-viejo', { expiresAt: ago(31) });
    await tok('t-caducado-reciente', { expiresAt: ago(5) });
    await tok('t-usado-reciente', { expiresAt: new Date(Date.now() + DAY), usedAt: ago(2) });
    await tok('t-vigente', { expiresAt: new Date(Date.now() + DAY) });

    const r = await t.app.get(CleanupService).run();
    expect(r).toEqual({ webhookProcessed: 1, webhookRejected: 1, sessions: 1, tokens: 2 });
    expect((await t.prisma.webhookEvent.findMany({ select: { dedupeKey: true }, orderBy: { dedupeKey: 'asc' } })).map((e) => e.dedupeKey)).toEqual(['rechazado-reciente', 'reciente-procesado', 'viejo-sin-procesar']);
    expect((await t.prisma.session.findMany()).map((s) => s.tokenHash)).toEqual(['s-vigente']);
    expect((await t.prisma.passwordResetToken.findMany({ orderBy: { tokenHash: 'asc' } })).map((x) => x.tokenHash)).toEqual(['t-caducado-reciente', 't-usado-reciente', 't-vigente']);
  });

  it('el cron diario ejecuta la limpieza (a través de runCronsFor a las 03:00 de Madrid)', async () => {
    await t.prisma.webhookEvent.create({ data: { signatureValid: false, field: null, payload: {}, receivedAt: ago(30) } });
    await t.app.get(JobsService).runCronsFor(new Date('2026-07-15T01:00:10Z')); // 03:00 Madrid (verano)
    expect(await t.prisma.webhookEvent.count({ where: { signatureValid: false } })).toBe(0);
  });
});

describe('F4a · #17 failedLast24h y crons vencidos', () => {
  async function insertFailed(table: 'job' | 'archive', completedAgoH: number) {
    const extra = table === 'archive' ? ', archived_on' : '';
    const extraV = table === 'archive' ? ', now()' : '';
    await t.prisma.$executeRawUnsafe(
      `INSERT INTO pgboss.${table} (id, name, priority, data, state, retry_limit, retry_count, retry_delay, retry_backoff, start_after, expire_in, created_on, completed_on, keep_until, policy${extra})
       VALUES (gen_random_uuid(), 'wa-send', 0, '{}', 'failed', 0, 0, 0, false, now(), interval '15 minutes', now(), now() - interval '${completedAgoH} hours', now() + interval '1 day', 'standard'${extraV})`,
    );
  }

  it('cuenta los fallidos de pgboss.job y de pgboss.archive de las últimas 24 h', async () => {
    const jobs = t.app.get(JobsService);
    await jobs.start();
    await t.prisma.$executeRawUnsafe('DELETE FROM pgboss.job');
    await t.prisma.$executeRawUnsafe('DELETE FROM pgboss.archive');
    await insertFailed('job', 1);
    await insertFailed('archive', 2);
    await insertFailed('archive', 5);
    await insertFailed('archive', 30); // fuera de las 24 h
    expect(await jobs.failedLast24h()).toBe(3);
  });

  it('dueCrons: tras un tick largo no se salta el minuto :07 ni las 03:00', () => {
    // último tick a las 11:06:20 (Madrid, invierno), el siguiente tarda y llega a las 11:08:30
    expect(dueCrons(new Date('2026-01-15T10:08:30Z'), new Date('2026-01-15T10:06:20Z'))).toEqual([QUEUES.CRON_MINUTE, QUEUES.CRON_HOURLY]);
    // sin histórico solo cuenta el minuto actual (comportamiento anterior)
    expect(dueCrons(new Date('2026-01-15T10:08:30Z'))).toEqual([QUEUES.CRON_MINUTE]);
    expect(dueCrons(new Date('2026-01-15T10:07:30Z'))).toEqual([QUEUES.CRON_MINUTE, QUEUES.CRON_HOURLY]);
    // 03:00 de verano (01:00 UTC) saltado por un tick de más de un minuto
    expect(dueCrons(new Date('2026-07-15T01:01:40Z'), new Date('2026-07-15T00:59:50Z'))).toEqual([QUEUES.CRON_MINUTE, QUEUES.CRON_DAILY]);
    // ticks normales: ni :07 ni 03:00 repetidos
    expect(dueCrons(new Date('2026-07-15T01:01:05Z'), new Date('2026-07-15T01:00:05Z'))).toEqual([QUEUES.CRON_MINUTE]);
    // cambio de hora (última noche de octubre): 03:00 Madrid ocurre una vez
    expect(dueCrons(new Date('2026-10-25T02:01:10Z'), new Date('2026-10-25T01:59:10Z'))).toEqual([QUEUES.CRON_MINUTE, QUEUES.CRON_DAILY]);
  });

  it('runCronsFor(now, since) lanza el cron horario vencido una sola vez', async () => {
    const jobs = t.app.get(JobsService);
    let hourly = 0;
    jobs.register(QUEUES.CRON_HOURLY, async () => void hourly++, {}, 'f4a-prueba');
    await jobs.runCronsFor(new Date('2026-01-15T10:09:30Z'), new Date('2026-01-15T10:05:20Z'));
    expect(hourly).toBe(1);
  });
});

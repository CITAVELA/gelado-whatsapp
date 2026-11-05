/**
 * S9 · Prueba TEMPORAL: una alta concurrente (entrante) entre la resolución y el lote de la importación
 * hace perder la baja NO PUBLICIDAD de esa fila.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, createTestApp, loginAs, type TestApp } from './utils/app';
import { ImportService } from '../src/modules/contacts/import.service';

let t: TestApp;
let admin: Awaited<ReturnType<typeof loginAs>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  admin = await loginAs(t, ADMIN_EMAIL);
});
const csrf = { 'X-Requested-With': 'XMLHttpRequest' };

async function prepare(csv: string) {
  const up = (await admin.agent.post('/api/contacts/import').set(csrf).attach('file', Buffer.from(csv), 'c.csv')).body;
  const pv = await admin.post(`/api/contacts/import/${up.jobId}/preview`, { mapping: up.suggestedMapping, onDuplicate: 'update' });
  expect(pv.status, JSON.stringify(pv.body)).toBe(201);
  return up.jobId as string;
}

describe('S9 · tmp importación', () => {
  it('H7: contacto creado por un entrante durante la importación → la fila NO PUBLICIDAD se descarta y el contacto queda sin baja', async () => {
    const jobId = await prepare('Nombre;Teléfono;Etiqueta\nAna;617498111;NO PUBLICIDAD\nLuis;617498112;PELUQUERÍA\n');
    const svc = t.app.get(ImportService) as any;
    const orig = svc.resolve.bind(svc);
    svc.resolve = async (...a: any[]) => {
      const r = await orig(...a);
      // el cliente escribe justo ahora: InboundMessagesService crea el contacto
      await t.prisma.contact.create({ data: { phoneE164: '+34617498111', waId: '34617498111', profileName: 'Ana' } });
      return r;
    };
    const run = await admin.post(`/api/contacts/import/${jobId}/run`, {});
    svc.resolve = orig;
    expect(run.status).toBe(201);
    const job = (await admin.get(`/api/contacts/import/${jobId}`)).body;
    const ana = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34617498111' } });
    expect(ana.consentStatus).toBe('UNKNOWN'); // la baja de la etiqueta se pierde
    expect(job.errors.some((e: any) => /No se pudo crear/.test(e.reason))).toBe(true);
  });
});

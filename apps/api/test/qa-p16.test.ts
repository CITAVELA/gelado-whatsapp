/**
 * QA · P16 (importador de Superchat, contactos «Sin WhatsApp»): pruebas adversarias sobre lo nuevo.
 * Complementa s12-telefonos, s12-superchat, s12-campanas y s12-supresion.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, type WaTestEnv } from './meta-simulator/harness';
import { ADMIN_EMAIL, AGENT_EMAIL, loginAs } from './utils/app';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});
const prisma = () => env.t.prisma;
const FIXTURE = path.resolve(__dirname, 'fixtures/superchat-export-sintetico.csv');

async function importFile(buf: Buffer, filename = 'export.csv', options: object = {}) {
  const a = await loginAs(env.t, AGENT_EMAIL);
  const up = await a.agent.post('/api/contacts/import').set('X-Requested-With', 'XMLHttpRequest').attach('file', buf, { filename, contentType: 'text/csv' });
  expect(up.status, JSON.stringify(up.body)).toBeLessThan(300);
  const jobId = up.body.jobId;
  const run = await a.post(`/api/contacts/import/${jobId}/run`, { mapping: up.body.suggestedMapping, ...options });
  expect(run.status, JSON.stringify(run.body)).toBeLessThan(300);
  for (let i = 0; i < 600; i++) {
    const st = await a.get(`/api/contacts/import/${jobId}`);
    if (['DONE', 'FAILED'].includes(st.body.status)) return { a, jobId, job: st.body, up: up.body };
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('la importación no terminó');
}

describe('P16 · el export sintético de Superchat (6.560 filas)', () => {
  it('importa 6.560 contactos: 6.253 con WhatsApp, 307 sin WhatsApp y 3 bajas; el mapeo de cabeceras es automático', async () => {
    const { job, up } = await importFile(fs.readFileSync(FIXTURE));
    expect(up.suggestedMapping['Dirección de correo electrónico']).toBe('email');
    expect(up.suggestedMapping['Teléfono']).toBe('phone');
    expect(up.suggestedMapping['Etiquetas']).toBe('labels');
    expect(job.status).toBe('DONE');
    expect(job.created).toBe(6560);
    expect(await prisma().contact.count({ where: { phoneE164: { not: null } } })).toBe(6253);
    expect(await prisma().contact.count({ where: { phoneE164: null } })).toBe(307);
    expect(await prisma().contact.count({ where: { consentStatus: 'REVOKED' } })).toBe(3);
  }, 120_000);

  it('volver a importar el mismo archivo no duplica nada (teléfono → correo → código) ni reactiva bajas', async () => {
    const buf = fs.readFileSync(FIXTURE);
    await importFile(buf);
    const { job } = await importFile(buf, 'export.csv', { initialConsent: 'GRANTED' });
    expect(job.created).toBe(0);
    expect(await prisma().contact.count()).toBe(6560);
    expect(await prisma().contact.count({ where: { phoneE164: null } })).toBe(307);
    expect(await prisma().contact.count({ where: { consentStatus: 'REVOKED' } })).toBe(3);
  }, 180_000);
});

describe('P16 · contactos sin teléfono', () => {
  const csv = (rows: string[]) => Buffer.from(['Nombre,Apellido,Teléfono,Dirección de correo electrónico,Etiquetas,Código', ...rows].join('\n'), 'utf8');

  it('dos filas sin teléfono con el mismo correo (distinto uso de mayúsculas) son un solo contacto; mismo código sin correo también', async () => {
    await importFile(csv([
      'Ana,Ruiz,,Ana.Ruiz@Ejemplo.test,,C-1',
      'Ana,Ruiz,,ana.ruiz@ejemplo.test,,',
      'Beto,Sanz,,,,C-9',
      'Beto,Sanz,,,,C-9',
    ]));
    const all = await prisma().contact.findMany({ orderBy: { createdAt: 'asc' } });
    expect(all).toHaveLength(2);
    expect(all.every((c) => c.phoneE164 === null)).toBe(true);
  });

  it('una fila sin teléfono, correo ni código se descarta con motivo; con solo código se importa', async () => {
    const { job } = await importFile(csv(['Fantasma,Nadie,,,,', 'Solo,Código,,,,C-77']));
    expect(await prisma().contact.count()).toBe(1);
    expect(job.skipped).toBe(1);
  });

  it('la API no crea un contacto sin teléfono, correo ni código (400 en español)', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const r = await a.post('/api/contacts', { firstName: 'Nadie' });
    expect(r.status).toBe(400);
    expect(String(r.body.message)).not.toMatch(/Required|Expected/);
  });

  it('un contacto sin teléfono no tiene conversación, no se puede abrir y sí se puede editar, etiquetar y exportar', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const c = (await a.post('/api/contacts', { email: 'solo@ejemplo.test', firstName: 'Soledad' })).body;
    expect(c.phoneE164).toBeNull();
    expect(c.conversationId).toBeNull();
    const open = await a.post('/api/conversations', { contactId: c.id });
    expect(open.status).toBeGreaterThanOrEqual(400);
    expect(open.status).toBeLessThan(500);
    const exp = await a.get('/api/contacts/export');
    expect(exp.status).toBe(200);
    expect(exp.text).toContain('solo@ejemplo.test');
    const edit = await a.patch(`/api/contacts/${c.id}`, { notes: 'Pendiente de pedir el móvil' });
    expect(edit.status).toBeLessThan(300);
    expect(edit.body.phoneE164).toBeNull();
  });

  it('al añadirle después un teléfono, pasa a tener WhatsApp (waId) y ya se puede abrir su conversación', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const c = (await a.post('/api/contacts', { email: 'luego@ejemplo.test', firstName: 'Luego' })).body;
    const upd = await a.patch(`/api/contacts/${c.id}`, { phone: '617 49 82 22' });
    expect(upd.status, JSON.stringify(upd.body)).toBeLessThan(300);
    expect(upd.body.phoneE164).toBe('+34617498222');
    const open = await a.post('/api/conversations', { phone: '+34617498222' });
    expect(open.status).toBeLessThan(300);
    expect(open.body.contactId).toBe(c.id);
  });

  it('un entrante de WhatsApp de un número nuevo no se «cuela» en un contacto sin teléfono por parecerse el nombre o el correo', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    await a.post('/api/contacts', { email: 'x@ejemplo.test', firstName: 'Cliente', lastName: 'Prueba' });
    await env.sim.sendInbound({ from: '34655000999', type: 'text', text: { body: 'hola' }, name: 'Cliente Prueba' });
    expect(await prisma().contact.count()).toBe(2);
    expect(await prisma().contact.count({ where: { phoneE164: null } })).toBe(1);
  });
});

describe('P16 · normalización de teléfonos de Superchat', () => {
  const csv = (rows: string[]) => Buffer.from(['Nombre,Teléfono', ...rows].join('\n'), 'utf8');
  it('«+6XXXXXXXX» se corrige a +34; incompleto, fijo y extranjero se tratan con aviso y nunca como móvil español', async () => {
    const { job } = await importFile(csv([
      'A,+629731421', // sin el 34 → +34629731421
      'B,+34 955 94 75 05', // fijo español
      'C,+63995483', // incompleto
      'D,+33 6 12 34 56 78', // extranjero
      'E,617498222', // normal
    ]));
    expect(job.status).toBe('DONE');
    const by = async (n: string) => prisma().contact.findFirstOrThrow({ where: { firstName: n } });
    expect((await by('A')).phoneE164).toBe('+34629731421');
    // un teléfono incompleto sin correo ni código no deja nada que importar: la fila se descarta con aviso
    expect(await prisma().contact.count({ where: { firstName: 'C' } })).toBe(0);
    expect(job.skipped).toBeGreaterThanOrEqual(1);
    expect((await by('D')).phoneE164).toBe('+33612345678');
    expect((await by('E')).phoneE164).toBe('+34617498222');
    // el fijo no recibe campañas de WhatsApp: o se importa sin teléfono o con aviso, pero nunca queda como móvil válido sin avisar
    const b = await by('B');
    const warned = JSON.stringify(job.errors ?? []).match(/Fijo español|fijo/i);
    expect(b.phoneE164 === null || !!warned).toBe(true);
  });
});

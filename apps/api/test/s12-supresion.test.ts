import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedTemplate, type WaTestEnv } from './meta-simulator/harness';
import { ADMIN_EMAIL, loginAs } from './utils/app';
import { resetConfigCache } from '../src/common/config';
import { hmacSha256Hex } from '../src/common/tokens';
import { SUPPRESSED_NOTE, SUPPRESSION_SALT_KEY, SuppressionService } from '../src/modules/contacts/suppression.service';
import { ImportService } from '../src/modules/contacts/import.service';

/** S12 · re-revisión N2, N3, N4, N10: lista de supresión (única puerta de alta, sal propia, reactivación, auditoría). */
let env: WaTestEnv;
let sup: SuppressionService;
const PHONE = '+34617498111';

beforeAll(async () => {
  env = await createWaTestEnv();
  sup = env.t.app.get(SuppressionService);
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
  sup.resetCache();
});
const prisma = () => env.t.prisma;

describe('N3 · sal propia de la lista de supresión', () => {
  it('se genera la primera vez, se guarda en Setting y no depende de SESSION_SECRET (rotarlo no invalida la lista)', async () => {
    await sup.add(PHONE);
    const row = await prisma().setting.findUniqueOrThrow({ where: { key: SUPPRESSION_SALT_KEY } });
    const salt = (row.value as { salt: string }).salt;
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    expect((await prisma().suppressedPhone.findFirstOrThrow()).phoneHash).toBe(hmacSha256Hex(salt, PHONE));
    expect(await sup.hash(PHONE)).not.toBe(hmacSha256Hex(process.env.SESSION_SECRET!, PHONE));
    // reinicio (la sal se relee de la BD, no se vuelve a generar) y rotación del secreto de sesión
    const old = process.env.SESSION_SECRET!;
    sup.resetCache();
    resetConfigCache({ SESSION_SECRET: 'secreto-de-sesion-rotado-0123456789abcdef' });
    try {
      expect(await sup.isSuppressed(PHONE)).toBe(true);
      expect(await sup.isSuppressed('+34600000000')).toBe(false);
    } finally {
      resetConfigCache({ SESSION_SECRET: old });
    }
    expect((await prisma().setting.findUniqueOrThrow({ where: { key: SUPPRESSION_SALT_KEY } })).value).toEqual({ salt });
  });
});

describe('N2 · toda alta de contacto aplica la lista de supresión', () => {
  it('«Nueva conversación» con un número suprimido: el contacto nace REVOKED (no UNKNOWN)', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    await sup.add(PHONE);
    const r = await a.post('/api/conversations', { phone: '617498111' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const c = await prisma().contact.findUniqueOrThrow({ where: { phoneE164: PHONE }, include: { consentEvents: true } });
    expect(c.consentStatus).toBe('REVOKED');
    expect(c.consentEvents).toHaveLength(1);
    expect(c.consentEvents[0]).toMatchObject({ source: 'MANUAL', note: SUPPRESSED_NOTE });
  });

  it('la prueba de campaña a un número suprimido crea el contacto REVOKED', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const tpl = await seedTemplate(env.t, { header: false });
    const d = await a.post('/api/campaigns', { name: 'Prueba', templateId: tpl.id, audience: { allContacts: true }, variableMapping: { 'body.1': { field: 'firstName', fallback: 'cliente' }, 'button.0': { text: 'x' } }, ratePerMinute: 20 });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    await sup.add(PHONE);
    await a.post(`/api/campaigns/${d.body.id}/test`, { phone: PHONE });
    const c = await prisma().contact.findUniqueOrThrow({ where: { phoneE164: PHONE } });
    expect(c.consentStatus).toBe('REVOKED');
    expect(await prisma().consentEvent.count({ where: { contactId: c.id, note: SUPPRESSED_NOTE } })).toBe(1);
  });

  it('un mensaje entrante de un número suprimido nace REVOKED (en la misma transacción)', async () => {
    await sup.add(PHONE);
    expect(await env.sim.sendInbound({ from: '34617498111', type: 'text', text: { body: 'Hola' } })).toBe(200);
    expect((await prisma().contact.findUniqueOrThrow({ where: { phoneE164: PHONE } })).consentStatus).toBe('REVOKED');
  });
});

describe('N4 · la supresión solo actúa al crear el contacto; reactivar quita el hash', () => {
  it('reactivar a mano a un suprimido lo saca de la lista y el siguiente mensaje no lo vuelve a dar de baja', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    await sup.add(PHONE);
    await env.sim.sendInbound({ from: '34617498111', type: 'text', text: { body: 'Hola' } });
    const c = await prisma().contact.findUniqueOrThrow({ where: { phoneE164: PHONE } });
    expect(c.consentStatus).toBe('REVOKED');
    expect(await prisma().suppressedPhone.count()).toBe(1);

    const r = await a.post(`/api/contacts/${c.id}/consent`, { status: 'GRANTED', source: 'MANUAL', note: 'Lo pidió por teléfono' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await prisma().suppressedPhone.count()).toBe(0);
    expect(await sup.isSuppressed(PHONE)).toBe(false);

    await env.sim.sendInbound({ from: '34617498111', type: 'text', text: { body: 'Otro mensaje' } });
    expect((await prisma().contact.findUniqueOrThrow({ where: { id: c.id } })).consentStatus).toBe('GRANTED');
    expect(await prisma().consentEvent.count({ where: { contactId: c.id } })).toBe(2); // baja por supresión + reactivación, nada más
  });

  it('un mensaje entrante de un contacto existente nunca consulta la lista (aunque su número estuviera en ella)', async () => {
    await env.sim.sendInbound({ from: '34617498111', type: 'text', text: { body: 'Hola' } });
    await sup.add(PHONE); // el número entra en la lista después de existir el contacto
    await env.sim.sendInbound({ from: '34617498111', type: 'text', text: { body: 'Sigo aquí' } });
    expect((await prisma().contact.findUniqueOrThrow({ where: { phoneE164: PHONE } })).consentStatus).toBe('UNKNOWN');
  });
});

describe('N10 · la supresión física anonimiza el número en el registro de auditoría', () => {
  it('registros antiguos con `data.phone` quedan con los últimos 4 dígitos', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const c = await prisma().contact.create({ data: { phoneE164: PHONE, waId: '34617498111', firstName: 'Ana' } });
    const other = await prisma().contact.create({ data: { phoneE164: '+34600000009', waId: '34600000009' } });
    await prisma().auditLog.create({ data: { action: 'test_campaign', data: { phone: PHONE, extra: 1 } } });
    await prisma().auditLog.create({ data: { action: 'test_campaign', data: { phone: other.phoneE164 } } });
    const r = await a.del(`/api/contacts/${c.id}?hard=true`);
    expect(r.status).toBe(200);
    const logs = await prisma().auditLog.findMany({ where: { action: 'test_campaign' }, orderBy: { createdAt: 'asc' } });
    expect(JSON.stringify(logs[0]!.data)).not.toContain('617498111');
    expect(logs[0]!.data).toEqual({ phoneLast4: '8111', extra: 1 });
    expect(logs[1]!.data).toEqual({ phone: '+34600000009' }); // el de otro contacto no se toca
  });
});

describe('P16 · importación: búsqueda del contacto que ganó la carrera', () => {
  it('sin waId no se casa con cualquier contacto (se filtran las condiciones vacías)', async () => {
    await prisma().contact.create({ data: { phoneE164: '+34600000001', waId: '34600000001' } });
    const b = await prisma().contact.create({ data: { phoneE164: '+34600000002', waId: '34600000002' } });
    const found = await (env.t.app.get(ImportService) as any).findExisting({ phoneE164: '+34600000002', waId: undefined, data: {} });
    expect(found?.id).toBe(b.id);
    expect(await (env.t.app.get(ImportService) as any).findExisting({ phoneE164: '+34600000099', waId: undefined, data: {} })).toBeNull();
  });
});

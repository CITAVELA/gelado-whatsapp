import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Papa from 'papaparse';
import { ADMIN_EMAIL, AGENT_EMAIL, createTestApp, loginAs, type TestApp } from './utils/app';
import { EXPECTED, HEADERS } from './fixtures/generar-superchat-sintetico';

/**
 * S12 · Importación de la exportación de Superchat (fixtures SINTÉTICOS, datos inventados).
 * Resultado esperado en BD vacía: 6.560 contactos, 6.253 con WhatsApp, 307 sin WhatsApp (291 sin teléfono + 16 incompletos),
 * 3 bajas y 0 duplicados.
 */
let t: TestApp;
let admin: Awaited<ReturnType<typeof loginAs>>;
let agent: Awaited<ReturnType<typeof loginAs>>;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  admin = await loginAs(t, ADMIN_EMAIL);
  agent = await loginAs(t, AGENT_EMAIL);
});

const FIX = join(__dirname, 'fixtures');
const exportCsv = readFileSync(join(FIX, 'superchat-export-sintetico.csv'));
const listaCsv = readFileSync(join(FIX, 'superchat-lista-peluqueria-sintetico.csv'));
const csrf = { 'X-Requested-With': 'XMLHttpRequest' };

async function upload(data: Buffer | string, name: string) {
  const r = await agent.agent.post('/api/contacts/import').set(csrf).attach('file', Buffer.from(data), name);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { jobId: string; columns: string[]; suggestedMapping: Record<string, string>; totalRows: number };
}
async function importFile(data: Buffer | string, name: string, opts: Record<string, unknown> = {}) {
  const up = await upload(data, name);
  const pv = await agent.post(`/api/contacts/import/${up.jobId}/preview`, { mapping: up.suggestedMapping, onDuplicate: 'update', ...opts });
  expect(pv.status, JSON.stringify(pv.body)).toBe(201);
  const t0 = Date.now();
  const run = await agent.post(`/api/contacts/import/${up.jobId}/run`, {});
  expect(run.status, JSON.stringify(run.body)).toBe(201);
  const job = (await agent.get(`/api/contacts/import/${up.jobId}`)).body;
  return { up, pv: pv.body, job, ms: Date.now() - t0 };
}

describe('S12 · fixture sintético de Superchat', () => {
  it('el fixture no contiene datos reales: correos @ejemplo.test y las 15 cabeceras de Superchat + Notas', () => {
    const parsed = Papa.parse<string[]>(exportCsv.toString('utf8'), { skipEmptyLines: true });
    expect(parsed.data[0]).toEqual([...HEADERS]);
    expect(parsed.data).toHaveLength(EXPECTED.total + 1);
    const emails = parsed.data.slice(1).map((r) => r[4]!).filter(Boolean);
    expect(emails.every((e) => e.endsWith('@ejemplo.test'))).toBe(true);
  });
});

describe('S12 · importación de la exportación general de Superchat', () => {
  it('mapea las cabeceras de Superchat solo y deja fuera ID, género y campañas (P9)', async () => {
    const up = await upload(exportCsv, 'superchat-export.csv');
    expect(up.totalRows).toBe(EXPECTED.total);
    expect(up.suggestedMapping).toEqual({
      ID: 'ignore', Nombre: 'firstName', Apellido: 'lastName', 'Teléfono': 'phone', 'Dirección de correo electrónico': 'email', Etiquetas: 'labels',
      'Código': 'customerCode', DNI: 'taxId', 'Teléfono Fijo': 'landline', 'Género': 'ignore', 'Último mensaje enviado en': 'ignore',
      'Último mensaje recibido en': 'ignore', 'IDs de campaña': 'ignore', 'Nombres de campañas': 'ignore', 'Campaña recibida en': 'ignore', Notas: 'notes',
    });
  });

  it('6.560 contactos: 6.253 con WhatsApp, 307 sin WhatsApp, 3 bajas, 0 duplicados, avisos por tipo y < 2 min', async () => {
    const { pv, job, ms } = await importFile(exportCsv, 'superchat-export.csv');
    // eslint-disable-next-line no-console
    console.log(`[S12] ${EXPECTED.total} filas de Superchat importadas en ${ms} ms`);
    expect(ms).toBeLessThan(120_000);

    // vista previa
    expect(pv).toMatchObject({ totalRows: 6560, willCreate: 6560, willUpdate: 0, willSkip: 0, willOptOut: 3, invalidPhone: 0, emptyRows: 0, duplicatesInFile: 0, withoutWhatsapp: 307 });
    expect(pv.issuesByCode).toEqual({ NO_WHATSAPP: 291, PHONE_INCOMPLETE: 16, FOREIGN: 18, LANDLINE: 239, PHONE_CORRECTED: 70, LANDLINE_INCOMPLETE: 4 });

    // informe del trabajo
    expect(job).toMatchObject({ status: 'DONE', created: 6560, updated: 0, skipped: 0, processedRows: 6560, optedOut: 3, withoutWhatsapp: 307 });
    expect(job.issuesByCode).toEqual(pv.issuesByCode);

    // base de datos
    const count = (where: object = {}) => t.prisma.contact.count({ where });
    expect(await count()).toBe(6560);
    expect(await count({ phoneE164: { not: null } })).toBe(6253);
    expect(await count({ phoneE164: null })).toBe(307);
    expect(await count({ consentStatus: 'REVOKED' })).toBe(3);
    expect(await t.prisma.consentEvent.count({ where: { status: 'REVOKED', source: 'LEGACY_LABEL' } })).toBe(3);
    // 0 duplicados: teléfonos, correos y códigos únicos
    const dupPhones = await t.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM (SELECT "phoneE164" FROM "Contact" WHERE "phoneE164" IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x`;
    const dupEmails = await t.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM (SELECT lower("email") FROM "Contact" WHERE "email" IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x`;
    const dupCodes = await t.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM (SELECT "customerCode" FROM "Contact" WHERE "customerCode" IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x`;
    expect([dupPhones[0]!.n, dupEmails[0]!.n, dupCodes[0]!.n]).toEqual([0, 0, 0]);

    // los 291 sin teléfono tienen correo y código; los 16 incompletos conservan el original en notas
    expect(await count({ phoneE164: null, email: { not: null }, customerCode: { not: null } })).toBe(307);
    expect(await count({ phoneE164: null, notes: { contains: 'Teléfono original: +' } })).toBe(16);
    // «+6XXXXXXXX» → +34XXXXXXXXX: ningún número de Nueva Caledonia, Indonesia, Tokelau…
    expect(await count({ phoneE164: { startsWith: '+6' } })).toBe(0);
    expect(await count({ phoneE164: { startsWith: '+34' } })).toBe(6253 - EXPECTED.foreign);
    expect(await count({ phoneE164: { not: null }, NOT: { phoneE164: { startsWith: '+34' } } })).toBe(EXPECTED.foreign);
    // fijos en notación científica convertidos a dígitos (106 completos; 4 incompletos se dejan tal cual)
    expect(await count({ landline: { contains: 'E' } })).toBe(EXPECTED.landlineScientificIncomplete);
    expect(await count({ landline: { not: null }, NOT: { landline: { contains: 'E' } } })).toBeGreaterThan(1800);
    // sin emojis en los nombres; DNI/CIF limpios; ID, género y campañas no se importan
    expect(await count({ OR: [{ firstName: { contains: '🌸' } }, { firstName: { contains: '✂' } }, { firstName: { contains: '💈' } }] })).toBe(0);
    expect(await count({ taxId: '-' })).toBe(0);
    expect(await count({ notes: { contains: 'Weiblich' } })).toBe(0);

    // etiquetas: TRANSPORTE se crea también como etiqueta de CONTACTO sin tocar la de conversación; NO PUBLICIDAD no es etiqueta
    const transporte = await t.prisma.label.findMany({ where: { name: 'TRANSPORTE' }, orderBy: { scope: 'asc' } });
    expect(transporte.map((l) => l.scope).sort()).toEqual(['CONTACT', 'CONVERSATION']);
    const conv = transporte.find((l) => l.scope === 'CONVERSATION')!;
    expect(conv).toMatchObject({ color: '#3B33A6', sortOrder: 3 });
    expect(await t.prisma.conversationLabel.count({ where: { labelId: conv.id } })).toBe(0);
    const contactT = transporte.find((l) => l.scope === 'CONTACT')!;
    expect(await t.prisma.contactLabel.count({ where: { labelId: contactT.id } })).toBe(EXPECTED.transporte);
    expect(await t.prisma.label.count({ where: { name: 'NO PUBLICIDAD' } })).toBe(0);
  }, 240_000);

  it('el informe CSV lista los avisos con su tipo', async () => {
    const { up } = await importFile(exportCsv, 'superchat-export.csv');
    const report = (await agent.get(`/api/contacts/import/${up.jobId}/report.csv`)).text;
    expect(report).toContain('País distinto de España: revisar');
    expect(report).toContain('Fijo español: probablemente sin WhatsApp');
    expect(report).toContain('Teléfono español incompleto');
    expect(report.split('\r\n').filter((l) => /;Sin WhatsApp$/.test(l))).toHaveLength(291);
  }, 240_000);
});

describe('S12 · listas de Superchat sobre la exportación general', () => {
  it('«Añadir etiqueta» + «Si existe: actualizar»: añade la etiqueta sin quitar otras, no duplica y respeta las bajas', async () => {
    await importFile(exportCsv, 'superchat-export.csv');
    const peluqueria = await t.prisma.label.findFirstOrThrow({ where: { name: 'PELUQUERÍA', scope: 'CONTACT' } });
    const before = await t.prisma.contact.count();
    const revokedBefore = await t.prisma.contact.findMany({ where: { consentStatus: 'REVOKED' }, select: { id: true } });
    expect(revokedBefore).toHaveLength(3);
    const transporteBefore = await t.prisma.contactLabel.count({ where: { label: { name: 'TRANSPORTE', scope: 'CONTACT' } } });

    const { pv, job } = await importFile(listaCsv, 'lista-peluqueria.csv', { addLabelIds: [peluqueria.id], onDuplicate: 'update' });
    expect(pv).toMatchObject({ totalRows: 40, willCreate: 5, willUpdate: 35, duplicatesInFile: 0, withoutWhatsapp: 2 });
    expect(job).toMatchObject({ status: 'DONE', created: 5, updated: 35, skipped: 0 });
    expect(await t.prisma.contact.count()).toBe(before + 5); // sin duplicar contactos
    expect(await t.prisma.contactLabel.count({ where: { labelId: peluqueria.id } })).toBe(40);
    // sin quitar otras etiquetas
    expect(await t.prisma.contactLabel.count({ where: { label: { name: 'TRANSPORTE', scope: 'CONTACT' } } })).toBe(transporteBefore);
    // los que ya tenían TRANSPORTE y están en la lista conservan ambas (si los hay en la muestra); el recuento global no baja
    // bajas: siguen REVOKED (aunque el archivo ya no traiga NO PUBLICIDAD) y no se crea ningún evento nuevo
    const revokedAfter = await t.prisma.contact.findMany({ where: { consentStatus: 'REVOKED' }, select: { id: true } });
    expect(revokedAfter.map((c) => c.id).sort()).toEqual(revokedBefore.map((c) => c.id).sort());
    expect(await t.prisma.consentEvent.count({ where: { status: 'REVOKED' } })).toBe(3);
    // actualiza datos: las notas de la lista; y la de los sin teléfono se encuentra por correo
    expect(await t.prisma.contact.count({ where: { notes: 'Lista Peluquería: datos actualizados' } })).toBe(35);
    expect(await t.prisma.contact.count({ where: { phoneE164: null } })).toBe(307);
  }, 240_000);

  it('tres listas (Peluquería, Barbería, Estética): un contacto en dos listas queda con las dos etiquetas', async () => {
    await importFile(exportCsv, 'superchat-export.csv');
    const labels = Object.fromEntries((await t.prisma.label.findMany({ where: { scope: 'CONTACT', name: { in: ['PELUQUERÍA', 'BARBERÍA', 'ESTÉTICA'] } } })).map((l) => [l.name, l.id]));
    const rows = Papa.parse<string[]>(listaCsv.toString('utf8'), { skipEmptyLines: true }).data;
    const head = rows[0]!;
    const body = rows.slice(1);
    const make = (sub: string[][]) => Papa.unparse([head, ...sub], { newline: '\n' });
    const files: Array<[string, string, string[][]]> = [
      ['PELUQUERÍA', 'peluqueria.csv', body.slice(0, 30)],
      ['BARBERÍA', 'barberia.csv', body.slice(20, 40)],
      ['ESTÉTICA', 'estetica.csv', body.slice(25, 40)],
    ];
    for (const [name, file, sub] of files) await importFile(make(sub), file, { addLabelIds: [labels[name]!], onDuplicate: 'update' });
    expect(await t.prisma.contact.count()).toBe(6560 + 5);
    const lc = async (name: string) => t.prisma.contactLabel.count({ where: { labelId: labels[name]! } });
    expect([await lc('PELUQUERÍA'), await lc('BARBERÍA'), await lc('ESTÉTICA')]).toEqual([30, 20, 15]);
    // filas 25..29 están en las tres listas
    const triple = await t.prisma.contact.count({ where: { AND: Object.values(labels).map((id) => ({ labels: { some: { labelId: id } } })) } });
    expect(triple).toBe(5);
    expect(await t.prisma.contact.count({ where: { consentStatus: 'REVOKED' } })).toBe(3);
  }, 240_000);
});

describe('S12 · reglas de importación fuera del fixture', () => {
  it('una fila sin teléfono, correo ni código se descarta con motivo; con código se importa Sin WhatsApp', async () => {
    const csv = 'Nombre,Teléfono,Dirección de correo electrónico,Código,Notas\nSolo Nombre,,,,\nCon Código,abc,,7777,Cliente VIP\nCon Correo,,Hola@Ejemplo.TEST,,\n';
    const { pv, job } = await importFile(csv, 'x.csv');
    expect(pv).toMatchObject({ willCreate: 2, invalidPhone: 1, withoutWhatsapp: 2 });
    expect(job).toMatchObject({ created: 2, skipped: 1 });
    const c = await t.prisma.contact.findFirstOrThrow({ where: { customerCode: '7777' } });
    expect(c.phoneE164).toBeNull();
    expect(c.notes).toBe('Cliente VIP\nTeléfono original: abc');
    expect((await t.prisma.contact.findFirstOrThrow({ where: { firstName: 'Con Correo' } })).email).toBe('hola@ejemplo.test');
    expect(job.errors.find((e: any) => e.kind === 'skipped').reason).toContain('Sin teléfono, correo ni código');
  });

  it('deduplica por teléfono; sin teléfono, por correo (sin mayúsculas); sin correo, por código (en el archivo y contra la BD)', async () => {
    await t.prisma.contact.createMany({
      data: [
        { phoneE164: null, email: 'ana@ejemplo.test', firstName: 'Ana previa' },
        { phoneE164: null, email: null, customerCode: '555', firstName: 'Código previo' },
      ],
    });
    const csv = [
      'Nombre,Teléfono,Dirección de correo electrónico,Código',
      'Ana,,ANA@ejemplo.test,',            // por correo contra la BD
      'Codigo,,,555',                      // por código contra la BD
      'Bea,,bea@ejemplo.test,',            // nueva
      'Bea otra,,BEA@EJEMPLO.TEST,',       // duplicada en el archivo (correo)
      'Cris,,,900',                        // nueva
      'Cris otra,,,900',                   // duplicada en el archivo (código)
      'Dani,617498222,dani@ejemplo.test,',
      'Dani otra,+34 617 49 82 22,,',      // duplicada (teléfono)
    ].join('\n');
    const { pv, job } = await importFile(csv, 'dup.csv');
    expect(pv).toMatchObject({ willCreate: 3, willUpdate: 2, duplicatesInFile: 3 });
    expect(job).toMatchObject({ status: 'DONE', created: 3, updated: 2 });
    expect(await t.prisma.contact.count()).toBe(2 + 3);
    expect((await t.prisma.contact.findFirstOrThrow({ where: { email: 'ana@ejemplo.test' } })).firstName).toBe('Ana');
  });

  it('un contacto dado de baja con teléfono nunca se reactiva al reimportarlo', async () => {
    const csv = 'Nombre,Teléfono,Etiquetas\nAna,617498222,NO PUBLICIDAD\n';
    await importFile(csv, 'a.csv');
    const second = await importFile('Nombre,Teléfono,Etiquetas\nAna,617498222,\n', 'b.csv', { initialConsent: 'GRANTED' });
    expect(second.job).toMatchObject({ created: 0, updated: 1 });
    expect((await t.prisma.contact.findFirstOrThrow()).consentStatus).toBe('REVOKED');
  });
});

describe('S12 · contactos sin teléfono en la API', () => {
  async function importTwo() {
    await importFile('Nombre,Teléfono,Dirección de correo electrónico,Código\nAna,617498222,ana@ejemplo.test,1\nBea,,bea@ejemplo.test,2\n', 'p.csv');
    return {
      ana: await t.prisma.contact.findFirstOrThrow({ where: { firstName: 'Ana' } }),
      bea: await t.prisma.contact.findFirstOrThrow({ where: { firstName: 'Bea' } }),
    };
  }

  it('filtro Con / sin WhatsApp, ficha con phoneE164 null y exportación con teléfono vacío', async () => {
    const { bea } = await importTwo();
    const without = (await admin.get('/api/contacts?whatsapp=without')).body;
    expect(without.total).toBe(1);
    expect(without.items[0]).toMatchObject({ id: bea.id, phoneE164: null, waId: null, displayName: 'Bea', conversationId: null });
    expect((await admin.get('/api/contacts?whatsapp=with')).body.total).toBe(1);
    expect((await admin.get('/api/contacts')).body.total).toBe(2);
    const csv = (await admin.get('/api/contacts/export')).text;
    expect(csv).toContain('Bea;;;bea@ejemplo.test');
    // el nombre cae a correo o código si no hay nada más
    await t.prisma.contact.update({ where: { id: bea.id }, data: { firstName: null } });
    expect((await admin.get(`/api/contacts/${bea.id}`)).body.displayName).toBe('bea@ejemplo.test');
  });

  it('no hay conversación sin teléfono: POST /api/conversations lo rechaza con mensaje claro', async () => {
    const { bea, ana } = await importTwo();
    const r = await agent.post('/api/conversations', { contactId: bea.id });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('sin WhatsApp');
    expect(await t.prisma.conversation.count()).toBe(0);
    const ok = await agent.post('/api/conversations', { contactId: ana.id });
    expect(ok.status).toBe(201);
    expect((await agent.post('/api/conversations', {})).status).toBe(400);
  });

  it('alta manual solo con correo; sin teléfono ni correo, 400; correo repetido, 409', async () => {
    const ok = await agent.post('/api/contacts', { firstName: 'Solo correo', email: 'Solo@Ejemplo.test' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ phoneE164: null, email: 'solo@ejemplo.test' });
    expect((await agent.post('/api/contacts', { firstName: 'Nada' })).status).toBe(400);
    const dup = await agent.post('/api/contacts', { email: 'SOLO@ejemplo.test' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('EMAIL_EXISTS');
    // añadir un teléfono a un contacto sin él; quitarlo si no hay conversación
    const withPhone = await agent.patch(`/api/contacts/${ok.body.id}`, { phone: '617 498 222' });
    expect(withPhone.body).toMatchObject({ phoneE164: '+34617498222', waId: '34617498222' });
    const cleared = await agent.patch(`/api/contacts/${ok.body.id}`, { phone: '' });
    expect(cleared.body).toMatchObject({ phoneE164: null, waId: null });
    // sin correo no se puede quitar el teléfono
    const mobileOnly = await agent.post('/api/contacts', { phone: '618000001' });
    expect((await agent.patch(`/api/contacts/${mobileOnly.body.id}`, { phone: '' })).status).toBe(400);
    // borrar un contacto sin teléfono (lógico y físico)
    expect((await admin.del(`/api/contacts/${ok.body.id}`)).status).toBe(200);
    const again = await agent.post('/api/contacts', { email: 'solo@ejemplo.test' });
    expect(again.status).toBe(201);
    expect((await admin.del(`/api/contacts/${again.body.id}?hard=true`)).status).toBe(200);
  });

  it('F-5: etiquetas que no son UUID en el filtro dan 400 en español (antes 500)', async () => {
    for (const q of ['includeLabelIds=no-uuid', 'excludeLabelIds=no-uuid', 'includeLabelIds=a,b']) {
      const r = await agent.get(`/api/contacts?${q}`);
      expect(r.status, q).toBe(400);
      expect(r.body.message).toContain('Etiqueta no válida');
    }
    expect((await agent.get('/api/contacts?includeLabelIds=')).status).toBe(200);
  });

  it('la BD exige teléfono, correo o código (CHECK) y permite varios sin teléfono', async () => {
    await t.prisma.contact.create({ data: { phoneE164: null, email: 'a@ejemplo.test' } });
    await t.prisma.contact.create({ data: { phoneE164: null, email: 'b@ejemplo.test' } });
    await expect(t.prisma.contact.create({ data: { phoneE164: null, firstName: 'Nadie' } })).rejects.toThrow();
  });
});

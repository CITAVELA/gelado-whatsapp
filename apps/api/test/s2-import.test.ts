import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ADMIN_EMAIL, AGENT_EMAIL, createTestApp, loginAs, type TestApp } from './utils/app';
import { cleanName, cleanTaxId } from '../src/modules/contacts/import.rules';

let t: TestApp;
let agent: Awaited<ReturnType<typeof loginAs>>;
let admin: Awaited<ReturnType<typeof loginAs>>;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  admin = await loginAs(t, ADMIN_EMAIL);
  agent = await loginAs(t, AGENT_EMAIL);
});

const csrf = { 'X-Requested-With': 'XMLHttpRequest' };
async function upload(s: typeof agent, data: Buffer | string, name = 'contactos.csv') {
  const r = await s.agent.post('/api/contacts/import').set(csrf).attach('file', Buffer.from(data), name);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { jobId: string; columns: string[]; suggestedMapping: Record<string, string>; sampleRows: any[]; totalRows: number };
}
const OPTS = { onDuplicate: 'update', createMissingLabels: true };
async function importAll(s: typeof agent, data: Buffer | string, name = 'contactos.csv', opts: Record<string, unknown> = {}) {
  const up = await upload(s, data, name);
  const options = { mapping: up.suggestedMapping, ...OPTS, ...opts };
  const pv = await s.post(`/api/contacts/import/${up.jobId}/preview`, options);
  expect(pv.status, JSON.stringify(pv.body)).toBe(201);
  const run = await s.post(`/api/contacts/import/${up.jobId}/run`, {});
  expect(run.status, JSON.stringify(run.body)).toBe(201);
  const job = (await s.get(`/api/contacts/import/${up.jobId}`)).body;
  return { up, pv: pv.body, job };
}

describe('S2 · importador: limpieza de datos (unidades)', () => {
  it('nombres sin emojis ni símbolos sueltos, con tildes y ñ', () => {
    expect(cleanName('  🌸 Marisol 💇‍♀️ ')).toBe('Marisol');
    expect(cleanName('Peluquería  ★ Núñez ™')).toBe('Peluquería Núñez');
    expect(cleanName('José-Luis • Pérez')).toBe('José-Luis Pérez');
    expect(cleanName('🔥🔥')).toBeNull();
    expect(cleanName("L'Oréal & Co")).toBe("L'Oréal & Co");
  });
  it('CIF/DNI/NIE: mayúsculas, sin espacios ni guiones', () => {
    expect(cleanTaxId('b-12 345.678')).toBe('B12345678');
    expect(cleanTaxId('x1234567l')).toBe('X1234567L');
    expect(cleanTaxId(' 12345678-z ')).toBe('12345678Z');
  });
});

describe('S2 · importador: reglas de RF-3.3 (área 7 de docs/08)', () => {
  it('detecta columnas y sugiere el mapeo al estilo Superchat', async () => {
    const csv = 'Nombre;Apellido;Teléfono;Teléfono Fijo;Dirección de correo electrónico;Código;DNI;Listas de contactos;Etiqueta;Género\nA;B;617498222;968000000;a@b.es;3990;B00000000;PELUQUERÍA;NO PUBLICIDAD;F\n';
    const up = await upload(agent, '﻿' + csv);
    expect(up.columns).toHaveLength(10);
    expect(up.suggestedMapping).toMatchObject({
      Nombre: 'firstName', Apellido: 'lastName', 'Teléfono': 'phone', 'Teléfono Fijo': 'landline', 'Dirección de correo electrónico': 'email',
      'Código': 'customerCode', DNI: 'taxId', 'Listas de contactos': 'labels', Etiqueta: 'labels', 'Género': 'ignore',
    });
    expect(up.totalRows).toBe(1);
    expect(up.sampleRows[0].Nombre).toBe('A');
    const media = await t.prisma.mediaFile.findFirstOrThrow();
    expect(media.mimeType).toBe('text/csv');
  });

  it('teléfonos españoles en todos los formatos, extranjeros válidos e inválidos descartados con motivo', async () => {
    const rows = [
      'Nombre,Teléfono',
      'Uno,617498222', 'Dos,+34 617 49 82 23', 'Tres,0034617498224', 'Cuatro,34617498225', 'Cinco,(34) 617-498-226', 'Seis,617 49 82 27',
      'Francia,+33 6 12 34 56 78', 'Portugal,00351 912 345 678',
      'Malo,12345', 'Letras,abc', 'Sin,', 'Largo,+34 617 49 82 22 99',
    ];
    const { pv, job } = await importAll(agent, rows.join('\n'));
    expect(pv).toMatchObject({ totalRows: 12, willCreate: 8, willSkip: 4, invalidPhone: 4 });
    expect(job).toMatchObject({ status: 'DONE', created: 8, updated: 0, skipped: 4, processedRows: 12 });
    const phones = (await t.prisma.contact.findMany({ select: { phoneE164: true }, orderBy: { phoneE164: 'asc' } })).map((c) => c.phoneE164);
    expect(phones).toEqual(['+33612345678', '+34617498222', '+34617498223', '+34617498224', '+34617498225', '+34617498226', '+34617498227', '+351912345678']);
    const invalid = job.errors.filter((e: any) => e.kind === 'skipped');
    expect(invalid.map((e: any) => e.row)).toEqual([10, 11, 12, 13]);
    expect(invalid[0].reason).toMatch(/Teléfono no válido/);
    expect(invalid[2].reason).toMatch(/Sin teléfono/);
  });

  it('duplicados en el archivo se unen (o se omiten); contra la BD se actualiza sin pisar con vacíos', async () => {
    await t.prisma.contact.create({ data: { phoneE164: '+34617498222', firstName: 'Original', email: 'viejo@ejemplo.es', company: 'Empresa vieja SL' } });
    const csv = ['Nombre,Teléfono,Correo,Empresa,Código', 'Nuevo,617498222,,,77', 'Otro,622111222,a@b.es,,', 'Otro nombre,+34622111222,,Empresa SL,5'].join('\n');
    const { pv, job } = await importAll(agent, csv);
    expect(pv).toMatchObject({ willCreate: 1, willUpdate: 1, duplicatesInFile: 1 });
    expect(job).toMatchObject({ created: 1, updated: 1, skipped: 1 });
    const old = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34617498222' } });
    expect(old).toMatchObject({ firstName: 'Nuevo', email: 'viejo@ejemplo.es', company: 'Empresa vieja SL', customerCode: '77' });
    const merged = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34622111222' } });
    expect(merged).toMatchObject({ firstName: 'Otro nombre', email: 'a@b.es', company: 'Empresa SL', customerCode: '5' });
    expect(job.errors.find((e: any) => e.kind === 'merged').reason).toMatch(/fila 3/);
  });

  it('con «omitir», los existentes y los duplicados del archivo no se tocan', async () => {
    await t.prisma.contact.create({ data: { phoneE164: '+34617498222', firstName: 'Original' } });
    const csv = ['Nombre,Teléfono', 'Pisa,617498222', 'Uno,622111222', 'Dos,622111222'].join('\n');
    const { job } = await importAll(agent, csv, 'c.csv', { onDuplicate: 'skip' });
    expect(job).toMatchObject({ created: 1, updated: 0, skipped: 2 });
    expect((await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34617498222' } })).firstName).toBe('Original');
    expect((await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34622111222' } })).firstName).toBe('Uno');
  });

  it('limpia nombres (emojis, símbolos), normaliza CIF y código, ignora filas vacías', async () => {
    const csv = ['Nombre,Apellidos,Teléfono,DNI,Código,Correo', '🌸 Marisol 💇‍♀️,García ★ Pérez,617498222,b-12 345 678,3990.0,MARISOL@EJEMPLO.ES', ',,,,,', '   ,  ,  ,,,', 'X,Y,622111222,x1234567l,0045,no-es-correo'].join('\n');
    const { pv, job } = await importAll(agent, csv);
    expect(pv).toMatchObject({ emptyRows: 2, willCreate: 2 });
    expect(job).toMatchObject({ created: 2, skipped: 2 });
    const a = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34617498222' } });
    expect(a).toMatchObject({ firstName: 'Marisol', lastName: 'García Pérez', taxId: 'B12345678', customerCode: '3990', email: 'marisol@ejemplo.es' });
    const b = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34622111222' } });
    expect(b).toMatchObject({ taxId: 'X1234567L', customerCode: '0045', email: null });
    expect(job.errors.some((e: any) => e.kind === 'warning' && /correo/.test(e.reason))).toBe(true);
  });

  it('etiquetas de la columna Listas/Etiqueta: crea las que faltan en mayúsculas; NO PUBLICIDAD = baja con origen LEGACY_LABEL y sin etiqueta', async () => {
    const csv = [
      'Nombre,Teléfono,Listas de contactos,Etiqueta',
      'A,617498222,"Peluquería, Jubilado / Proveedor",',
      'B,622111222,barbería,NO PUBLICIDAD',
      'C,633222333,,no publicidad',
    ].join('\n');
    const { pv, job } = await importAll(agent, csv, 'c.csv', { addLabelIds: [(await t.prisma.label.findFirstOrThrow({ where: { name: 'INSTITUTO' } })).id] });
    expect(pv.willOptOut).toBe(2);
    expect(job).toMatchObject({ created: 3, optedOut: 2, labelsCreated: 1 });
    const a = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34617498222' }, include: { labels: { include: { label: true } } } });
    expect(a.labels.map((l) => l.label.name).sort()).toEqual(['INSTITUTO', 'JUBILADO', 'PELUQUERÍA', 'PROVEEDOR']);
    expect(a.consentStatus).toBe('UNKNOWN');
    expect(await t.prisma.label.count({ where: { name: 'NO PUBLICIDAD' } })).toBe(0);
    const b = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34622111222' } });
    expect(b.consentStatus).toBe('REVOKED');
    const ev = await t.prisma.consentEvent.findMany({ where: { contactId: b.id } });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ status: 'REVOKED', source: 'LEGACY_LABEL' });
    expect((await t.prisma.contact.count({ where: { consentStatus: 'REVOKED' } }))).toBe(2);
  });

  it('un contacto existente con NO PUBLICIDAD pasa a baja por ConsentService; uno ya de baja no se reactiva con consentimiento inicial', async () => {
    const ex = await t.prisma.contact.create({ data: { phoneE164: '+34617498222', consentStatus: 'GRANTED' } });
    const rev = await t.prisma.contact.create({ data: { phoneE164: '+34622111222', consentStatus: 'REVOKED' } });
    const csv = ['Nombre,Teléfono,Etiqueta', 'A,617498222,NO PUBLICIDAD', 'B,622111222,'].join('\n');
    await importAll(agent, csv, 'c.csv', { initialConsent: 'GRANTED' });
    expect((await t.prisma.contact.findUniqueOrThrow({ where: { id: ex.id } })).consentStatus).toBe('REVOKED');
    expect((await t.prisma.contact.findUniqueOrThrow({ where: { id: rev.id } })).consentStatus).toBe('REVOKED');
    expect(await t.prisma.consentEvent.count({ where: { contactId: ex.id, source: 'LEGACY_LABEL' } })).toBe(1);
  });

  it('consentimiento inicial GRANTED deja evento IMPORT en los nuevos', async () => {
    await importAll(agent, 'Nombre,Teléfono\nA,617498222\n', 'c.csv', { initialConsent: 'GRANTED' });
    const c = await t.prisma.contact.findFirstOrThrow();
    expect(c.consentStatus).toBe('GRANTED');
    expect(await t.prisma.consentEvent.count({ where: { contactId: c.id, status: 'GRANTED', source: 'IMPORT' } })).toBe(1);
  });

  it('un contacto borrado que vuelve en el archivo se reactiva y conserva su baja', async () => {
    const d = await t.prisma.contact.create({ data: { phoneE164: '+34617498222', firstName: 'Viejo', consentStatus: 'REVOKED', deletedAt: new Date() } });
    const { job } = await importAll(agent, 'Nombre,Teléfono\nNuevo,617498222\n');
    expect(job.created).toBe(1);
    const c = await t.prisma.contact.findUniqueOrThrow({ where: { id: d.id } });
    expect(c).toMatchObject({ firstName: 'Nuevo', deletedAt: null, consentStatus: 'REVOKED' });
  });

  it('Excel (.xlsx): teléfonos numéricos, celdas con formato, hoja con filas vacías', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Contactos');
    ws.addRow(['Nombre', 'Móvil', 'CIF', 'Código', 'Listas']);
    ws.addRow(['Marisol', 617498222, 'b-00000000', 3990, 'PELUQUERÍA']);
    ws.addRow([]);
    ws.addRow(['Nuria', '+34 622 11 12 22', 'Q0000000A', '2210', 'NO PUBLICIDAD']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const { up, job } = await importAll(agent, buf, 'clientes.xlsx');
    expect(up.suggestedMapping).toMatchObject({ Nombre: 'firstName', 'Móvil': 'phone', CIF: 'taxId', 'Código': 'customerCode', Listas: 'labels' });
    expect(job).toMatchObject({ status: 'DONE', created: 2, skipped: 1, totalRows: 3 });
    const m = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34617498222' } });
    expect(m).toMatchObject({ taxId: 'B00000000', customerCode: '3990' });
    expect((await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34622111222' } })).consentStatus).toBe('REVOKED');
  });

  it('CSV en Windows-1252 y con separador «;» se lee bien', async () => {
    const buf = Buffer.from('Nombre;Teléfono\r\nJosé Núñez;617498222\r\n', 'latin1');
    const { job } = await importAll(agent, buf);
    expect(job.created).toBe(1);
    expect((await t.prisma.contact.findFirstOrThrow()).firstName).toBe('José Núñez');
  });

  it('errores de uso: sin columna de teléfono, archivo vacío, formato no admitido, trabajo inexistente, doble ejecución', async () => {
    const up = await upload(agent, 'Nombre,Teléfono\nA,617498222\n');
    const noPhone = await agent.post(`/api/contacts/import/${up.jobId}/preview`, { mapping: { Nombre: 'firstName', 'Teléfono': 'ignore' } });
    expect(noPhone.status).toBe(400);
    expect(noPhone.body.message).toMatch(/teléfono/i);
    expect((await agent.post(`/api/contacts/import/${up.jobId}/run`, {})).status).toBe(400); // sin vista previa
    const empty = await agent.agent.post('/api/contacts/import').set(csrf).attach('file', Buffer.from(''), 'v.csv');
    expect(empty.status).toBe(400);
    const xls = await agent.agent.post('/api/contacts/import').set(csrf).attach('file', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]), 'v.xls');
    expect(xls.status).toBe(400);
    expect(xls.body.message).toMatch(/xlsx/);
    expect((await agent.get('/api/contacts/import/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    await agent.post(`/api/contacts/import/${up.jobId}/preview`, { mapping: up.suggestedMapping });
    expect((await agent.post(`/api/contacts/import/${up.jobId}/run`, {})).status).toBe(201);
    expect((await agent.post(`/api/contacts/import/${up.jobId}/run`, {})).status).toBe(409);
  });

  it('informe descargable y auditoría', async () => {
    const { up } = await importAll(agent, 'Nombre,Teléfono\nA,617498222\nMalo,12\n');
    const r = await agent.get(`/api/contacts/import/${up.jobId}/report.csv`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text).toContain('Fila;Resultado;Motivo;Valor');
    expect(r.text).toMatch(/3;Descartada;Teléfono no válido/);
    expect(r.text).toMatch(/Creados: 1/);
    expect(await t.prisma.auditLog.count({ where: { action: 'import_contacts' } })).toBe(1);
  });
});

// ── 7.000 filas con todos los problemas ──

function buildBigCsv(total = 7000) {
  const lines = ['Nombre;Apellido;Teléfono;Teléfono Fijo;Dirección de correo electrónico;Código;DNI;Listas de contactos;Etiqueta;Género'];
  const exp = { valid: 0, invalid: 0, empty: 0, dups: 0, optOut: 0, foreign: 0 };
  const validPhones: string[] = [];
  const types = ['PELUQUERÍA', 'BARBERÍA', 'ESTÉTICA', 'INSTITUTO', 'JUBILADO'];
  const baseRows = total - 20;
  const cell = (s: string | number) => String(s);
  for (let i = 0; i < baseRows; i++) {
    if (i % 211 === 5) { lines.push(';;;;;;;;;'); exp.empty++; continue; }
    if (i % 97 === 3) { lines.push(`Malo ${i};Tel;${i % 2 ? 'abc' : '12 34'};;;;;;;;`); exp.invalid++; continue; }
    let phone: string;
    if (i % 50 === 7) { phone = `+33 6 ${String(10000000 + i).replace(/(\d\d)(?=\d)/g, '$1 ').trim()}`; exp.foreign++; }
    else {
      const n = `6${String(10000000 + i).padStart(8, '0')}`;
      phone = [n, `+34 ${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`, `0034${n}`, `34${n}`][i % 4]!;
    }
    validPhones.push(phone);
    exp.valid++;
    const optOut = i % 31 === 0;
    if (optOut) exp.optOut++;
    const name = i % 13 === 0 ? `🌸 Nombre${i} 💇‍♀️` : `Nombre${i}`;
    lines.push([name, `Apellido ★ ${i}`, phone, i % 5 ? '' : '968000000', i % 3 ? `c${i}@ejemplo.es` : '', cell(1000 + i), `b-${String(10000000 + i)}`, types[i % 5]!, optOut ? 'NO PUBLICIDAD' : '', 'F'].join(';'));
  }
  // 20 duplicados del teléfono de las primeras filas válidas (en otro formato)
  for (let k = 0; k < 20; k++) {
    const digits = validPhones[k]!.replace(/\D/g, '').replace(/^0034/, '34');
    lines.push(`Dup${k};Dup;${digits.startsWith('34') || digits.startsWith('33') ? '+' + digits : digits};;;;;;;`);
    exp.dups++;
  }
  return { csv: lines.join('\r\n') + '\r\n', exp, total };
}

describe('S2 · importador: 7.000 filas con problemas (rendimiento y informe)', () => {
  it('importa 7.000 filas en menos de 2 minutos con informe correcto', async () => {
    const { csv, exp, total } = buildBigCsv();
    // 50 contactos ya existentes (se actualizan) y 1 borrado
    const existing = Array.from({ length: 50 }, (_, k) => ({ phoneE164: `+34${'6' + String(10000000 + 4 * (k + 10)).padStart(8, '0')}`, firstName: 'Previo', email: 'previo@ejemplo.es' }));
    await t.prisma.contact.createMany({ data: existing });
    const t0 = Date.now();
    const up = await upload(agent, csv, 'superchat_contactos.csv');
    const pv = await agent.post(`/api/contacts/import/${up.jobId}/preview`, { mapping: up.suggestedMapping, onDuplicate: 'update' });
    expect(pv.status).toBe(201);
    const tPreview = Date.now() - t0;
    const run = await agent.post(`/api/contacts/import/${up.jobId}/run`, {});
    expect(run.status).toBe(201);
    const ms = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[S2] 7.000 filas: subir+vista previa ${tPreview} ms · total con importación ${ms} ms`);
    expect(ms).toBeLessThan(120_000);

    const job = (await agent.get(`/api/contacts/import/${up.jobId}`)).body;
    expect(up.totalRows).toBe(total);
    expect(pv.body).toMatchObject({ totalRows: total, invalidPhone: exp.invalid, emptyRows: exp.empty, duplicatesInFile: exp.dups, willOptOut: exp.optOut });
    expect(job.status).toBe('DONE');
    expect(job.processedRows).toBe(total);
    expect(await t.prisma.contact.count({ where: { firstName: 'Previo' } })).toBeLessThan(existing.length); // los que venían en el archivo se actualizaron
    expect(job.created + job.updated).toBe(exp.valid);
    expect(job.updated).toBeGreaterThan(0);
    expect(job.skipped).toBe(total - exp.valid);
    expect(await t.prisma.contact.count()).toBe(exp.valid + (existing.length - job.updated)); // los previos que no venían en el archivo siguen ahí
    // sin pisar con vacíos: los previos sin correo en el archivo conservan el suyo
    expect(await t.prisma.contact.count({ where: { email: 'previo@ejemplo.es' } })).toBeGreaterThan(0);
    // bajas
    expect(job.optedOut).toBeGreaterThanOrEqual(exp.optOut - existing.length);
    expect(await t.prisma.contact.count({ where: { consentStatus: 'REVOKED' } })).toBe(exp.optOut);
    expect(await t.prisma.contact.count({ where: { consentStatus: 'REVOKED', phoneE164: { in: existing.map((e) => e.phoneE164) } } })).toBeLessThanOrEqual(existing.length);
    expect(await t.prisma.consentEvent.count({ where: { source: 'LEGACY_LABEL', status: 'REVOKED' } })).toBe(exp.optOut);
    expect(await t.prisma.label.count({ where: { name: 'NO PUBLICIDAD' } })).toBe(0);
    // limpieza
    const emoji = await t.prisma.contact.count({ where: { OR: [{ firstName: { contains: '🌸' } }, { lastName: { contains: '★' } }] } });
    expect(emoji).toBe(0);
    expect(await t.prisma.contact.count({ where: { taxId: { startsWith: 'B' } } })).toBeGreaterThan(5000);
    expect(await t.prisma.contact.count({ where: { phoneE164: { startsWith: '+33' } } })).toBe(exp.foreign);
    // informe
    const report = (await agent.get(`/api/contacts/import/${up.jobId}/report.csv`)).text;
    const lines = report.trim().split('\r\n');
    expect(lines.filter((l) => /;Descartada;Teléfono no válido|;Descartada;Sin teléfono/.test(l))).toHaveLength(exp.invalid);
    expect(lines.filter((l) => /;Descartada;Fila vacía/.test(l))).toHaveLength(exp.empty);
    expect(lines.filter((l) => /;Unida;/.test(l))).toHaveLength(exp.dups);
    // etiquetas de tipo de cliente existentes, ninguna etiqueta nueva
    expect(job.labelsCreated).toBe(0);
  }, 180_000);
});

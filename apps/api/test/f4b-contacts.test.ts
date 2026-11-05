/**
 * F4b · correcciones de contactos e importación:
 *  S9 #7 (P7 obligatorio) · #8 (carrera importación/entrante) · #9 = S10 M6 (supresión física + lista de supresión)
 *  · #10 (ConsentService avisa por WebSocket) · S10 M5 (bomba zip en XLSX).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { ADMIN_EMAIL, createTestApp, loginAs, type TestApp } from './utils/app';
import { ImportService } from '../src/modules/contacts/import.service';
import { ConsentService } from '../src/modules/contacts/consent.service';
import { ContactFactory } from '../src/modules/contacts/contact-factory.service';
import { SuppressionService, SUPPRESSED_NOTE } from '../src/modules/contacts/suppression.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { RealtimeService } from '../src/modules/realtime/realtime.gateway';
import { assertSafeXlsx, parseFile } from '../src/modules/contacts/import.parser';

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

async function prepare(csv: string, opts: Record<string, unknown> = {}) {
  const up = (await admin.agent.post('/api/contacts/import').set(csrf).attach('file', Buffer.from(csv), 'c.csv')).body;
  const pv = await admin.post(`/api/contacts/import/${up.jobId}/preview`, { mapping: up.suggestedMapping, onDuplicate: 'update', ...opts });
  expect(pv.status, JSON.stringify(pv.body)).toBe(201);
  return { jobId: up.jobId as string, preview: pv.body };
}
async function runImport(csv: string, opts: Record<string, unknown> = {}) {
  const { jobId, preview } = await prepare(csv, opts);
  const run = await admin.post(`/api/contacts/import/${jobId}/run`, {});
  expect(run.status, JSON.stringify(run.body)).toBe(201);
  return { jobId, preview, job: (await admin.get(`/api/contacts/import/${jobId}`)).body };
}

describe('F4b · P7: NO PUBLICIDAD siempre es baja (S9 #7)', () => {
  it('aunque la petición llegue con optOutLabelValues vacío, la fila queda REVOKED, sin etiqueta NO PUBLICIDAD y con las opciones auditadas', async () => {
    const csv = 'Nombre;Teléfono;Etiqueta\nAna;617498111;NO PUBLICIDAD\nLuis;617498112;PELUQUERÍA\n';
    const { preview, job, jobId } = await runImport(csv, { optOutLabelValues: [] });
    expect(preview.willOptOut).toBe(1);
    expect(job).toMatchObject({ status: 'DONE', created: 2, optedOut: 1 });
    const ana = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34617498111' }, include: { labels: true } });
    expect(ana.consentStatus).toBe('REVOKED');
    expect(ana.labels).toHaveLength(0);
    expect((await t.prisma.consentEvent.findFirstOrThrow({ where: { contactId: ana.id } })).source).toBe('LEGACY_LABEL');
    expect(await t.prisma.label.count({ where: { name: 'NO PUBLICIDAD' } })).toBe(0);
    const log = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'import_contacts', entityId: jobId } });
    expect((log.data as any).options).toMatchObject({ onDuplicate: 'update', initialConsent: 'UNKNOWN', createMissingLabels: true });
    expect((log.data as any).options.optOutLabelValues).toContain('NO PUBLICIDAD');
  });

  it('«no publicidad» en minúsculas o con espacios también es baja y el servidor lo añade si falta', async () => {
    const { job } = await runImport('Nombre;Teléfono;Etiqueta\nAna;617498111;  no   publicidad \n', { optOutLabelValues: ['OTRA'] });
    expect(job.optedOut).toBe(1);
    expect((await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34617498111' } })).consentStatus).toBe('REVOKED');
  });

  it('con «omitir existentes», la baja del archivo se aplica igualmente a un contacto existente', async () => {
    const c = await t.prisma.contact.create({ data: { phoneE164: '+34617498111', waId: '34617498111', firstName: 'Ana', consentStatus: 'GRANTED' } });
    const { job } = await runImport('Nombre;Teléfono;Etiqueta\nAna Nueva;617498111;NO PUBLICIDAD\n', { onDuplicate: 'skip' });
    expect(job).toMatchObject({ created: 0, updated: 0 });
    const after = await t.prisma.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.consentStatus).toBe('REVOKED');
    expect(after.firstName).toBe('Ana'); // los datos no se tocan
  });
});

describe('F4b · carrera importación / mensaje entrante (S9 #8, antes H7)', () => {
  it('un contacto creado por un entrante durante la importación recibe la baja NO PUBLICIDAD (ruta de actualización) y no se pierde la fila', async () => {
    const { jobId } = await prepare('Nombre;Teléfono;Etiqueta\nAna;617498111;NO PUBLICIDAD\nLuis;617498112;PELUQUERÍA\n');
    const svc = t.app.get(ImportService) as any;
    const orig = svc.resolve.bind(svc);
    svc.resolve = async (...a: any[]) => {
      const r = await orig(...a);
      await t.prisma.contact.create({ data: { phoneE164: '+34617498111', waId: '34617498111', profileName: 'Ana' } }); // el entrante escribe justo ahora
      return r;
    };
    const run = await admin.post(`/api/contacts/import/${jobId}/run`, {});
    svc.resolve = orig;
    expect(run.status).toBe(201);
    const job = (await admin.get(`/api/contacts/import/${jobId}`)).body;
    expect(job.status).toBe('DONE');
    expect(job.errors.some((e: any) => /No se pudo crear/.test(e.reason))).toBe(false);
    expect(job).toMatchObject({ created: 1, updated: 1 });
    const ana = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34617498111' } });
    expect(ana.consentStatus).toBe('REVOKED');
    expect(ana.firstName).toBe('Ana'); // y se completan los datos
    const ev = await t.prisma.consentEvent.findFirstOrThrow({ where: { contactId: ana.id } });
    expect(ev).toMatchObject({ status: 'REVOKED', source: 'LEGACY_LABEL' });
    expect(await t.prisma.contact.count()).toBe(2);
  });

  it('si el contacto de la carrera es el de otro wa_id con el mismo número (borrado antes), se reactiva con la baja', async () => {
    const { jobId } = await prepare('Nombre;Teléfono;Etiqueta\nAna;617498111;NO PUBLICIDAD\n');
    const svc = t.app.get(ImportService) as any;
    const orig = svc.resolve.bind(svc);
    svc.resolve = async (...a: any[]) => {
      const r = await orig(...a);
      await t.prisma.contact.create({ data: { phoneE164: '+34617498111', waId: '34617498111', deletedAt: new Date() } });
      return r;
    };
    await admin.post(`/api/contacts/import/${jobId}/run`, {});
    svc.resolve = orig;
    const ana = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34617498111' } });
    expect(ana.deletedAt).toBeNull();
    expect(ana.consentStatus).toBe('REVOKED');
  });
});

describe('F4b · supresión física completa y lista de supresión (S9 #9 = S10 M6)', () => {
  const PHONE = '+34617498111';
  const WA = '34617498111';
  let storage: StorageService;
  const put = async (p: string) => storage.upload(p, Buffer.from('x'), { contentType: 'image/png', upsert: true });
  const exists = (p: string) => storage.download(p).then(() => true, () => false);

  async function seed() {
    storage = t.app.get(StorageService);
    const mk = (path: string, source: 'INBOUND' | 'LIBRARY' = 'INBOUND') =>
      t.prisma.mediaFile.create({ data: { storagePath: path, mimeType: 'image/png', sizeBytes: 1, source } });
    const own = await mk('f4b/own.png');
    const shared = await mk('f4b/shared.png');
    const lib = await mk('f4b/lib.png', 'LIBRARY');
    const imp = await mk('f4b/import.csv');
    for (const p of ['f4b/own.png', 'f4b/shared.png', 'f4b/lib.png', 'f4b/import.csv']) await put(p);
    await t.prisma.libraryFile.create({ data: { name: 'Catálogo', mediaFileId: lib.id } });
    const admin0 = await t.prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    await t.prisma.importJob.create({ data: { fileName: 'c.csv', mediaFileId: imp.id, status: 'DONE', createdById: admin0.id } });
    const a = await t.prisma.contact.create({ data: { phoneE164: PHONE, waId: WA, firstName: 'Ana', consentStatus: 'GRANTED' } });
    const b = await t.prisma.contact.create({ data: { phoneE164: '+34622000111', waId: '34622000111', firstName: 'Bea' } });
    const ca = await t.prisma.conversation.create({ data: { contactId: a.id } });
    const cb = await t.prisma.conversation.create({ data: { contactId: b.id } });
    const msg = (conversationId: string, mediaId: string) =>
      t.prisma.message.create({ data: { conversationId, direction: 'INBOUND', kind: 'IMAGE', status: 'RECEIVED', mediaId } });
    await msg(ca.id, own.id);
    await msg(ca.id, shared.id);
    await msg(ca.id, lib.id);
    await msg(ca.id, imp.id);
    await msg(cb.id, shared.id);
    const ev = (n: number, payload: unknown, over: Record<string, unknown> = {}) =>
      t.prisma.webhookEvent.create({ data: { signatureValid: true, field: 'messages', dedupeKey: `k${n}`, payload: payload as any, processedAt: new Date(), ...over } });
    await ev(1, { entry: [{ changes: [{ value: { contacts: [{ wa_id: WA }], messages: [{ from: WA, type: 'text' }] } }] }] });
    await ev(2, { entry: [{ changes: [{ value: { statuses: [{ recipient_id: WA }] } }] }] }, { processedAt: null, error: 'boom' });
    await ev(3, { entry: [{ changes: [{ value: { messages: [{ from: WA }] } }] }] }, { processedAt: null }); // pendiente: se respeta
    await ev(4, { entry: [{ changes: [{ value: { messages: [{ from: '34622000111' }] } }] }] });
    await ev(5, { entry: [{ changes: [{ value: { messages: [{ from: '9' + WA }] } }] }] }); // número más largo que lo contiene
    return { a, b, own, shared, lib, imp };
  }

  it('borra adjuntos propios y su objeto de Storage, respeta los de biblioteca, de otros mensajes y de importaciones, y limpia los WebhookEvent con su wa_id', async () => {
    const { a } = await seed();
    const r = await admin.del(`/api/contacts/${a.id}?hard=true`);
    expect(r.status).toBe(200);
    expect(await t.prisma.contact.findUnique({ where: { id: a.id } })).toBeNull();
    // media
    const paths = (await t.prisma.mediaFile.findMany()).map((m) => m.storagePath).sort();
    expect(paths).toEqual(['f4b/import.csv', 'f4b/lib.png', 'f4b/shared.png']);
    expect(await exists('f4b/own.png')).toBe(false);
    expect(await exists('f4b/shared.png')).toBe(true);
    expect(await exists('f4b/lib.png')).toBe(true);
    expect(await exists('f4b/import.csv')).toBe(true);
    // webhook: se van el procesado y el fallido con su número; quedan el pendiente, el de otro número y el de número más largo
    expect((await t.prisma.webhookEvent.findMany({ orderBy: { dedupeKey: 'asc' } })).map((e) => e.dedupeKey)).toEqual(['k3', 'k4', 'k5']);
    // auditoría sin datos personales
    const log = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'hard_delete_contact' } });
    expect(log.data).toMatchObject({ mediaDeleted: 1, webhookEventsDeleted: 2 });
    expect(JSON.stringify(log.data)).not.toContain('617498111');
  });

  it('guarda solo el hash del teléfono (HMAC con una sal propia), no el número', async () => {
    const { a } = await seed();
    await admin.del(`/api/contacts/${a.id}?hard=true`);
    const rows = await t.prisma.suppressedPhone.findMany();
    expect(rows).toHaveLength(1);
    const sup = t.app.get(SuppressionService);
    expect(rows[0]!.phoneHash).toBe(await sup.hash(PHONE));
    expect(rows[0]!.phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain('617498111');
    expect(await sup.isSuppressed(PHONE)).toBe(true);
    expect(await sup.isSuppressed('+34600000000')).toBe(false);
    // el borrado lógico no suprime
    const b = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34622000111' } });
    await admin.del(`/api/contacts/${b.id}`);
    expect(await sup.isSuppressed('+34622000111')).toBe(false);
  });

  it('si el número vuelve por ALTA MANUAL, el contacto nace REVOKED (MANUAL, «Suprimido previamente»)', async () => {
    const { a } = await seed();
    await admin.del(`/api/contacts/${a.id}?hard=true`);
    const r = await admin.post('/api/contacts', { phone: '617498111', firstName: 'Ana de nuevo' });
    expect(r.status).toBe(201);
    expect(r.body.consentStatus).toBe('REVOKED');
    const ev = await t.prisma.consentEvent.findFirstOrThrow({ where: { contactId: r.body.id } });
    expect(ev).toMatchObject({ status: 'REVOKED', source: 'MANUAL', note: SUPPRESSED_NOTE });
  });

  it('si el número vuelve por IMPORTACIÓN, nace REVOKED aunque el consentimiento inicial sea «Con consentimiento»', async () => {
    const { a } = await seed();
    await admin.del(`/api/contacts/${a.id}?hard=true`);
    const { preview, job } = await runImport('Nombre;Teléfono\nAna;617498111\nCarla;617498333\n', { initialConsent: 'GRANTED' });
    expect(preview.willOptOut).toBe(1);
    expect(job).toMatchObject({ created: 2, optedOut: 1 });
    const ana = await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: PHONE } });
    expect(ana.consentStatus).toBe('REVOKED');
    expect(await t.prisma.consentEvent.findFirstOrThrow({ where: { contactId: ana.id } })).toMatchObject({ source: 'MANUAL', note: SUPPRESSED_NOTE });
    expect((await t.prisma.contact.findUniqueOrThrow({ where: { phoneE164: '+34617498333' } })).consentStatus).toBe('GRANTED');
  });

  it('ContactFactory (única puerta de alta): un número suprimido nace REVOKED; uno no suprimido, UNKNOWN', async () => {
    const { a } = await seed();
    await admin.del(`/api/contacts/${a.id}?hard=true`);
    const f = t.app.get(ContactFactory);
    const c = await f.create({ phoneE164: PHONE, waId: WA, profileName: 'Ana' }); // lo que hace InboundMessagesService
    expect((await t.prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).consentStatus).toBe('REVOKED');
    expect(await t.prisma.consentEvent.findFirstOrThrow({ where: { contactId: c.id } })).toMatchObject({ source: 'MANUAL', note: SUPPRESSED_NOTE });
    const d = await f.create({ phoneE164: '+34600999888', waId: '34600999888' });
    expect((await t.prisma.contact.findUniqueOrThrow({ where: { id: d.id } })).consentStatus).toBe('UNKNOWN');
  });
});

describe('F4b · ConsentService avisa por WebSocket (S9 #10)', () => {
  it('un cambio de consentimiento emite event.created y conversation.updated', async () => {
    const c = await t.prisma.contact.create({ data: { phoneE164: '+34617498111', waId: '34617498111', firstName: 'Ana' } });
    const conv = await t.prisma.conversation.create({ data: { contactId: c.id } });
    const rt = t.app.get(RealtimeService);
    rt.emitted.length = 0;
    await t.app.get(ConsentService).setConsent(c.id, 'REVOKED', 'WHATSAPP_KEYWORD');
    const ev = rt.emitted.find((e) => e.event === 'event.created')!.payload as any;
    expect(ev.conversationId).toBe(conv.id);
    expect(ev.event).toMatchObject({ type: 'CONSENT_CHANGED' });
    const upd = rt.emitted.find((e) => e.event === 'conversation.updated')!.payload as any;
    expect(upd.conversation.id).toBe(conv.id);
    // sin cambio, no se emite nada
    rt.emitted.length = 0;
    await t.app.get(ConsentService).setConsent(c.id, 'REVOKED', 'WHATSAPP_KEYWORD');
    expect(rt.emitted).toHaveLength(0);
  });

  it('un contacto sin conversación no emite (y no falla)', async () => {
    const c = await t.prisma.contact.create({ data: { phoneE164: '+34617498111', waId: '34617498111' } });
    const rt = t.app.get(RealtimeService);
    rt.emitted.length = 0;
    await expect(t.app.get(ConsentService).setConsent(c.id, 'GRANTED', 'MANUAL', { userId: null })).resolves.toEqual({ changed: true });
    expect(rt.emitted).toHaveLength(0);
  });
});

// ── bomba zip ──

const crc32 = (() => {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  return (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

/** Zip mínimo de una sola entrada (deflate) con el contenido dado; sirve de .xlsx «bomba» sin ser un Excel válido. */
function zipOf(name: string, content: Buffer): Buffer {
  const comp = deflateRawSync(content);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(content), 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc32(content), 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(content.length, 24); cd.writeUInt16LE(nameBuf.length, 28);
  const localPart = Buffer.concat([local, nameBuf, comp]);
  const cdPart = Buffer.concat([cd, nameBuf]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cdPart.length, 12); eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, cdPart, eocd]);
}

describe('F4b · bomba zip en XLSX (S10 M5)', () => {
  it('un .xlsx de unos KB que descomprime a 60 MB se rechaza antes de ExcelJS, con mensaje claro', async () => {
    const bomb = zipOf('xl/worksheets/sheet1.xml', Buffer.alloc(60 * 1024 * 1024, 0x61));
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(() => assertSafeXlsx(bomb)).toThrow(/demasiado grande una vez descomprimido \(máximo 50 MB\)/);
    await expect(parseFile('bomba.xlsx', bomb)).rejects.toThrow(/máximo 50 MB/);
  });

  it('también se rechaza por proporción (> 100) aunque no llegue a 50 MB', () => {
    const dense = zipOf('xl/worksheets/sheet1.xml', Buffer.alloc(10 * 1024 * 1024, 0x61)); // ~10 KB → 10 MB
    expect(() => assertSafeXlsx(dense)).toThrow(/demasiado comprimido|demasiado grande/);
  });

  it('por HTTP: la subida da 400 con el mensaje y no crea la importación', async () => {
    const bomb = zipOf('xl/worksheets/sheet1.xml', Buffer.alloc(60 * 1024 * 1024, 0x61));
    const r = await admin.agent.post('/api/contacts/import').set(csrf).attach('file', bomb, 'bomba.xlsx');
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/máximo 50 MB/);
    expect(await t.prisma.importJob.count()).toBe(0);
  });

  it('un Excel normal sigue importándose', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hoja1');
    ws.addRow(['Nombre', 'Teléfono']);
    for (let i = 0; i < 2000; i++) ws.addRow([`Cliente ${i}`, `6${String(10000000 + i)}`]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(() => assertSafeXlsx(buf)).not.toThrow();
    const parsed = await parseFile('ok.xlsx', buf);
    expect(parsed.rows).toHaveLength(2000);
  });
});

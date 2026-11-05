import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, AGENT_EMAIL, createTestApp, loginAs, type TestApp } from './utils/app';

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

const label = (name: string) => t.prisma.label.findFirstOrThrow({ where: { name, scope: 'CONTACT' } });
async function mk(phone: string, extra: Record<string, unknown> = {}) {
  const r = await admin.post('/api/contacts', { phone, ...extra });
  expect(r.status).toBe(201);
  return r.body as { id: string; phoneE164: string; consentStatus: string };
}

describe('S2 · contactos: ficha, listado y búsqueda (RF-3.1, RF-3.2)', () => {
  it('crea con teléfono normalizado y rechaza duplicado con 409 claro', async () => {
    const c = await mk('617 49 82 22', { firstName: 'Marisol', lastName: 'García', taxId: 'b-12345678' });
    expect(c.phoneE164).toBe('+34617498222');
    const dup = await agent.post('/api/contacts', { phone: '0034617498222' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/Ya existe un contacto con ese teléfono/);
    const bad = await agent.post('/api/contacts', { phone: '12' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/Teléfono no válido/);
  });

  it('edita la ficha (PATCH parcial no borra el resto) y cambia el teléfono con control de duplicados', async () => {
    const a = await mk('617498222', { firstName: 'Ana', company: 'Salón Ana', email: 'ana@ejemplo.es' });
    const b = await mk('+34 622 111 222');
    const r = await agent.patch(`/api/contacts/${a.id}`, { lastName: 'Ruiz' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ firstName: 'Ana', lastName: 'Ruiz', company: 'Salón Ana', email: 'ana@ejemplo.es' });
    const conflict = await agent.patch(`/api/contacts/${a.id}`, { phone: '622111222' });
    expect(conflict.status).toBe(409);
    const ok = await agent.patch(`/api/contacts/${a.id}`, { phone: '633 000 111', email: '' });
    expect(ok.body.phoneE164).toBe('+34633000111');
    expect(ok.body.email).toBeNull();
    expect((await agent.get(`/api/contacts/${b.id}`)).status).toBe(200);
  });

  it('busca sin tildes ni mayúsculas por nombre, empresa, teléfono, código y CIF', async () => {
    await mk('617498222', { firstName: 'José', lastName: 'Núñez', company: 'Peluquería Marisol', customerCode: '3990', taxId: 'B12345678' });
    await mk('622111222', { firstName: 'Otra', lastName: 'Persona' });
    const q = async (s: string) => (await agent.get(`/api/contacts?q=${encodeURIComponent(s)}`)).body;
    expect((await q('jose nunez')).total).toBe(1);
    expect((await q('NUÑEZ')).total).toBe(1);
    expect((await q('peluqueria')).total).toBe(1);
    expect((await q('617 49 82')).total).toBe(1);
    expect((await q('+34617498222')).total).toBe(1);
    expect((await q('3990')).total).toBe(1);
    expect((await q('b12345678')).total).toBe(1);
    expect((await q('inexistente')).total).toBe(0);
    expect((await agent.get('/api/contacts')).body.total).toBe(2);
  });

  it('filtra por etiquetas incluir/excluir, consentimiento y teléfono inválido; pagina de 100 en 100', async () => {
    const pel = await label('PELUQUERÍA');
    const bar = await label('BARBERÍA');
    const a = await mk('617498222', { firstName: 'A', labelIds: [pel.id] });
    const b = await mk('622111222', { firstName: 'B', labelIds: [pel.id, bar.id] });
    const c = await mk('633222333', { firstName: 'C', labelIds: [bar.id] });
    await mk('644333444', { firstName: 'D' });
    const ids = async (qs: string) => ((await agent.get(`/api/contacts?${qs}`)).body.items as { id: string }[]).map((x) => x.id).sort();
    expect(await ids(`includeLabelIds=${pel.id}`)).toEqual([a.id, b.id].sort());
    expect(await ids(`includeLabelIds=${pel.id}&excludeLabelIds=${bar.id}`)).toEqual([a.id]);
    expect(await ids(`excludeLabelIds=${pel.id},${bar.id}`)).toHaveLength(1);
    await admin.post(`/api/contacts/${c.id}/consent`, { status: 'REVOKED', source: 'MANUAL', note: 'Lo pidió por teléfono' });
    expect(await ids('consent=REVOKED')).toEqual([c.id]);
    await t.prisma.contact.update({ where: { id: a.id }, data: { phoneInvalid: true } });
    expect(await ids('phoneInvalid=true')).toEqual([a.id]);
    expect(await ids('phoneInvalid=false')).toHaveLength(3);
    const page = (await agent.get('/api/contacts')).body;
    expect(page).toMatchObject({ total: 4, page: 1, pageSize: 100 });
    expect((await agent.get('/api/contacts?pageSize=2&page=2')).body.items).toHaveLength(2);
  });

  it('el listado devuelve etiquetas, consentimiento y conversación', async () => {
    const pel = await label('PELUQUERÍA');
    const a = await mk('617498222', { firstName: 'A', labelIds: [pel.id] });
    const conv = await t.prisma.conversation.create({ data: { contactId: a.id, lastMessageAt: new Date() } });
    const row = (await agent.get('/api/contacts')).body.items[0];
    expect(row.labels[0].name).toBe('PELUQUERÍA');
    expect(row.conversationId).toBe(conv.id);
    expect(row.lastActivityAt).toBeTruthy();
    const sorted = await agent.get('/api/contacts?sort=lastActivity');
    expect(sorted.status).toBe(200);
  });
});

describe('S2 · consentimiento y bajas (RF-3.6, regla 5)', () => {
  it('el cambio deja historial con origen, nota y usuario; REVOKED solo se reactiva con usuario y queda auditado', async () => {
    const c = await mk('617498222');
    const r1 = await agent.post(`/api/contacts/${c.id}/consent`, { status: 'GRANTED', source: 'MANUAL', note: 'Firmó el formulario' });
    expect(r1.body.consentStatus).toBe('GRANTED');
    await agent.post(`/api/contacts/${c.id}/consent`, { status: 'REVOKED', source: 'MANUAL', note: 'Baja pedida' });
    const hist = (await agent.get(`/api/contacts/${c.id}/consent`)).body;
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({ status: 'REVOKED', source: 'MANUAL', note: 'Baja pedida', userName: 'Cristina Lopez' });

    // el sistema (sin usuario) no puede reactivar
    const { ConsentService } = await import('../src/modules/contacts/consent.service');
    const svc = t.app.get(ConsentService);
    await expect(svc.setConsent(c.id, 'GRANTED', 'IMPORT', {})).rejects.toThrow(/usuario/);
    // con usuario sí
    const back = await agent.post(`/api/contacts/${c.id}/consent`, { status: 'GRANTED', source: 'MANUAL', note: 'Se ha vuelto a apuntar' });
    expect(back.body.consentStatus).toBe('GRANTED');
    const audits = await t.prisma.auditLog.findMany({ where: { action: 'consent_change', entityId: c.id } });
    expect(audits).toHaveLength(3);
  });

  it('acciones en bloque: etiquetas y consentimiento', async () => {
    const pel = await label('PELUQUERÍA');
    const a = await mk('617498222');
    const b = await mk('622111222');
    const r = await agent.post('/api/contacts/bulk', { contactIds: [a.id, b.id], action: 'addLabel', labelId: pel.id });
    expect(r.body).toMatchObject({ affected: 2 });
    expect((await agent.post('/api/contacts/bulk', { contactIds: [a.id, b.id], action: 'addLabel', labelId: pel.id })).body.affected).toBe(0);
    expect((await agent.post('/api/contacts/bulk', { contactIds: [a.id], action: 'removeLabel', labelId: pel.id })).body.affected).toBe(1);
    const c = await agent.post('/api/contacts/bulk', { contactIds: [a.id, b.id], action: 'setConsent', consent: { status: 'REVOKED', source: 'MANUAL', note: 'Lote' } });
    expect(c.body.affected).toBe(2);
    expect(await t.prisma.consentEvent.count({ where: { status: 'REVOKED', note: 'Lote' } })).toBe(2);
    const conv = await agent.post('/api/contacts/bulk', { contactIds: [a.id], action: 'addLabel', labelId: (await t.prisma.label.findFirstOrThrow({ where: { scope: 'CONVERSATION' } })).id });
    expect(conv.status).toBe(400);
  });
});

describe('S2 · borrado, exportación y campañas (RF-3.4, regla 7)', () => {
  it('borrado lógico solo admin: desaparece de listados y búsquedas; se puede volver a crear con el mismo teléfono', async () => {
    const c = await mk('617498222', { firstName: 'Borrame' });
    expect((await agent.del(`/api/contacts/${c.id}`)).status).toBe(403);
    expect((await admin.del(`/api/contacts/${c.id}`)).status).toBe(200);
    expect((await agent.get('/api/contacts')).body.total).toBe(0);
    expect((await agent.get('/api/contacts?q=borrame')).body.total).toBe(0);
    expect((await agent.get(`/api/contacts/${c.id}`)).status).toBe(404);
    expect(await t.prisma.auditLog.count({ where: { action: 'delete_contact', entityId: c.id } })).toBe(1);
    const again = await agent.post('/api/contacts', { phone: '617498222', firstName: 'Nuevo' });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(c.id);
    expect(again.body.firstName).toBe('Nuevo');
  });

  it('borrado físico (?hard=true) solo admin: elimina conversación, mensajes, envíos y deja auditoría', async () => {
    const c = await mk('617498222', { firstName: 'Suprimir' });
    const conv = await t.prisma.conversation.create({ data: { contactId: c.id } });
    await t.prisma.message.create({ data: { conversationId: conv.id, direction: 'INBOUND', kind: 'TEXT', body: 'hola', status: 'RECEIVED' } });
    expect((await agent.del(`/api/contacts/${c.id}?hard=true`)).status).toBe(403);
    const r = await admin.del(`/api/contacts/${c.id}?hard=true`);
    expect(r.status).toBe(200);
    expect(await t.prisma.contact.count()).toBe(0);
    expect(await t.prisma.conversation.count()).toBe(0);
    expect(await t.prisma.message.count()).toBe(0);
    const log = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'hard_delete_contact' } });
    expect(log.entityId).toBe(c.id);
    expect(JSON.stringify(log.data)).not.toContain('617498222');
  });

  it('exportar CSV: solo admin, `;` y BOM, con filtros, y deja auditoría', async () => {
    const pel = await label('PELUQUERÍA');
    await mk('617498222', { firstName: 'Marisol', lastName: 'García; "Pérez"', labelIds: [pel.id], notes: '=CMD()' });
    await mk('622111222', { firstName: 'Otro' });
    expect((await agent.get('/api/contacts/export')).status).toBe(403);
    const r = await admin.get('/api/contacts/export');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="contactos-\d{4}-\d{2}-\d{2}\.csv"/);
    const body = r.text;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body.split('\r\n')[0]).toBe('﻿Nombre;Apellidos;Teléfono;Correo;Empresa;Código;DNI/CIF;Teléfono fijo;Etiquetas;Consentimiento;Fecha consentimiento;Notas;Creado');
    expect(body).toContain('"García; ""Pérez"""');
    expect(body).toContain("'=CMD()");
    expect(body).toContain(';+34617498222;');
    const filtered = await admin.get(`/api/contacts/export?includeLabelIds=${pel.id}`);
    expect(filtered.text.trim().split('\r\n')).toHaveLength(2);
    const a = await t.prisma.contact.findFirstOrThrow({ where: { firstName: 'Otro' } });
    const sel = await admin.get(`/api/contacts/export?ids=${a.id},no-es-uuid`);
    expect(sel.text.trim().split('\r\n')).toHaveLength(2);
    expect(sel.text).toContain('Otro');
    expect(await t.prisma.auditLog.count({ where: { action: 'export_contacts' } })).toBe(3);
  });

  it('campañas recibidas: [] si no hay y lista si las hay', async () => {
    const c = await mk('617498222');
    expect((await agent.get(`/api/contacts/${c.id}/campaigns`)).body).toEqual([]);
    const user = await t.prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    const tpl = await t.prisma.template.create({ data: { name: 'promo', language: 'es', category: 'MARKETING', status: 'APPROVED', components: [] } as any });
    const camp = await t.prisma.campaign.create({ data: { name: 'Tintes KUKIT', templateId: tpl.id, variableMapping: {}, audience: {}, createdById: user.id } });
    await t.prisma.campaignRecipient.create({ data: { campaignId: camp.id, contactId: c.id, phoneE164: '+34617498222', status: 'READ', readAt: new Date() } });
    const r = (await agent.get(`/api/contacts/${c.id}/campaigns`)).body;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'Tintes KUKIT', status: 'READ' });
  });
});

describe('S2 · etiquetas (RF-3.5)', () => {
  it('crear: agentes también; editar y borrar: solo admin; nombre en mayúsculas único', async () => {
    const r = await agent.post('/api/labels', { name: 'Jubilado nuevo', color: '#112233', scope: 'CONTACT' });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe('JUBILADO NUEVO');
    expect((await agent.post('/api/labels', { name: 'jubilado nuevo', color: '#112233', scope: 'CONTACT' })).status).toBe(409);
    expect((await agent.post('/api/labels', { name: 'JUBILADO NUEVO', color: '#112233', scope: 'CONVERSATION' })).status).toBe(201);
    expect((await agent.patch(`/api/labels/${r.body.id}`, { color: '#000000' })).status).toBe(403);
    const up = await admin.patch(`/api/labels/${r.body.id}`, { color: '#000000', showAsInboxView: true, sortOrder: 9 });
    expect(up.body).toMatchObject({ color: '#000000', showAsInboxView: true, sortOrder: 9, name: 'JUBILADO NUEVO' });
    expect((await agent.del(`/api/labels/${r.body.id}`)).status).toBe(403);
    expect((await admin.del(`/api/labels/${r.body.id}`)).status).toBe(200);
    const list = (await agent.get('/api/labels?scope=CONTACT')).body as { scope: string }[];
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(list.every((l) => l.scope === 'CONTACT')).toBe(true);
  });

  it('borrar una etiqueta la quita de los contactos', async () => {
    const pel = await label('PELUQUERÍA');
    const c = await mk('617498222', { labelIds: [pel.id] });
    await admin.del(`/api/labels/${pel.id}`);
    expect((await agent.get(`/api/contacts/${c.id}`)).body.labels).toEqual([]);
  });
});

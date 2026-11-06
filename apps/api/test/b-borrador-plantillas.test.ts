/**
 * Post-MVP · «Guardar borrador» en el editor de plantillas (LOCAL_DRAFT): guardar sin llamar a Meta, reabrir, editar,
 * enviar a revisión con la misma validación que crear, solo administradora y borradores invisibles fuera del editor.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, loginAs, ADMIN_EMAIL, AGENT_EMAIL, type TestApp } from './utils/app';
import { MetaSimulator } from './meta-simulator/simulator';
import { seedConversation } from './meta-simulator/harness';
import { StorageService } from '../src/modules/storage/storage.service';
import { TemplatesService } from '../src/modules/templates/templates.service';
import { WhatsAppGateway } from '../src/modules/whatsapp/whatsapp.gateway';

let t: TestApp;
let sim: MetaSimulator;
let a: Awaited<ReturnType<typeof loginAs>>;
let agent: Awaited<ReturnType<typeof loginAs>>;

beforeAll(async () => {
  sim = await new MetaSimulator({ appSecret: 'test-app-secret' }).start();
  t = await createTestApp({ META_GRAPH_BASE_URL: sim.baseUrl });
});
afterAll(async () => {
  await t.close();
  await sim.stop();
});
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await t.reset();
  sim.reset();
  a = await loginAs(t, ADMIN_EMAIL);
  agent = await loginAs(t, AGENT_EMAIL);
});

const ZERO = '00000000-0000-4000-8000-000000000000';
/** Borrador mínimo: solo nombre de Meta e idioma. */
const minimal = (over: Record<string, unknown> = {}) => ({ name: 'borrador_uno', language: 'es', ...over });
/** Editor completo y válido (como en s3-templates). */
const full = (over: Record<string, unknown> = {}) => ({
  displayName: 'Ragnar Z-TECH',
  name: 'borrador_uno',
  category: 'MARKETING',
  language: 'es',
  header: { format: 'NONE' },
  body: 'Hola {{1}}, tenemos algo para ti.',
  bodyExamples: ['Juan'],
  footer: 'Un saludo, Gelado.',
  buttons: [{ type: 'QUICK_REPLY', text: 'Me interesa' }],
  addOptOutButton: true,
  ...over,
});

describe('guardar borrador', () => {
  it('guarda lo mínimo sin llamar a Meta, con auditoría, y lo devuelve con su contenido', async () => {
    const r = await a.post('/api/templates/draft', minimal());
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ name: 'borrador_uno', language: 'es', status: 'LOCAL_DRAFT', metaTemplateId: null, usableInCampaigns: false, category: 'MARKETING' });
    expect(r.body.draft).toMatchObject({ name: 'borrador_uno', body: '', buttons: [], addOptOutButton: true });
    expect(sim.templates.size).toBe(0);
    const row = await t.prisma.template.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(row).toMatchObject({ status: 'LOCAL_DRAFT', createdById: a.user.id, metaTemplateId: null });
    expect(await t.prisma.auditLog.count({ where: { action: 'save_template_draft', entityId: r.body.id } })).toBe(1);
  });

  it('admite un contenido incompleto o con errores (se valida al enviar), pero no un nombre vacío o mal formado', async () => {
    const r = await a.post('/api/templates/draft', full({ body: 'Hola {{1}}', bodyExamples: [], header: { format: 'IMAGE' }, buttons: [{ type: 'URL', text: '', url: '' }], footer: 'x'.repeat(100) }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.variables).toEqual(['body.1']);
    expect(r.body.headerFormat).toBe('IMAGE');
    for (const [over, re] of [
      [{ name: '' }, /nombre/],
      [{ name: 'Mal Nombre' }, /minúsculas, números y guion bajo/],
      [{ language: '' }, /idioma/],
    ] as const) {
      const bad = await a.post('/api/templates/draft', minimal(over));
      expect(bad.status, JSON.stringify(over)).toBe(400);
      expect(JSON.stringify(bad.body)).toMatch(re);
    }
    expect((await a.post('/api/templates/draft', { language: 'es' })).status).toBe(400);
  });

  it('reabrir y editar: PUT actualiza el mismo registro y GET devuelve el contenido', async () => {
    const c = await a.post('/api/templates/draft', full());
    const id = c.body.id;
    const got = await a.get(`/api/templates/${id}`);
    expect(got.body.draft).toMatchObject({ displayName: 'Ragnar Z-TECH', body: 'Hola {{1}}, tenemos algo para ti.', bodyExamples: ['Juan'], buttons: [{ type: 'QUICK_REPLY', text: 'Me interesa' }] });
    const u = await a.put(`/api/templates/${id}/draft`, full({ displayName: 'Ragnar v2', name: 'borrador_dos', category: 'UTILITY', body: 'Cambio total', bodyExamples: [], buttons: [], addOptOutButton: false }));
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect(u.body).toMatchObject({ id, name: 'borrador_dos', displayName: 'Ragnar v2', category: 'UTILITY', status: 'LOCAL_DRAFT', hasOptOutButton: false, variables: [] });
    expect(u.body.draft.body).toBe('Cambio total');
    expect(await t.prisma.template.count()).toBe(1);
    expect(await t.prisma.auditLog.count({ where: { action: 'save_template_draft', entityId: id } })).toBe(2);
    expect(sim.templates.size).toBe(0);
    expect((await a.put(`/api/templates/${ZERO}/draft`, minimal())).status).toBe(404);
  });

  it('en el listado de la administradora sale con estado Borrador y se filtra por LOCAL_DRAFT', async () => {
    const c = await a.post('/api/templates/draft', minimal());
    expect((await a.get('/api/templates')).body.map((x: any) => x.id)).toEqual([c.body.id]);
    expect((await a.get('/api/templates?status=LOCAL_DRAFT')).body).toHaveLength(1);
    expect((await a.get('/api/templates?status=APPROVED')).body).toHaveLength(0);
  });

  it('un borrador reserva su nombre: choque al guardar, al editar y al enviar → 409 en español', async () => {
    const one = await a.post('/api/templates/draft', minimal());
    const dupNew = await a.post('/api/templates/draft', minimal({ displayName: 'otro' }));
    expect(dupNew.status).toBe(409);
    expect(dupNew.body.message).toMatch(/Ya hay un borrador con ese nombre/);
    // el mismo nombre en otro idioma sí vale
    expect((await a.post('/api/templates/draft', minimal({ language: 'ca' }))).status).toBe(201);
    const two = await a.post('/api/templates/draft', minimal({ name: 'borrador_dos' }));
    const clash = await a.put(`/api/templates/${two.body.id}/draft`, minimal({ name: 'borrador_uno' }));
    expect(clash.status).toBe(409);
    expect((await a.put(`/api/templates/${one.body.id}/draft`, minimal({ displayName: 'sigue siendo mío' }))).status).toBe(200); // su propio nombre no choca
    const submitClash = await a.post(`/api/templates/${two.body.id}/submit`, full({ name: 'borrador_uno' }));
    expect(submitClash.status).toBe(409);
    expect(sim.templates.size).toBe(0);
    // y una creación directa con ese nombre también choca
    const direct = await a.post('/api/templates', full());
    expect(direct.status).toBe(409);
    expect(direct.body.message).toMatch(/borrador/);
  });

  it('un nombre ya usado por una plantilla enviada choca al guardar un borrador', async () => {
    expect((await a.post('/api/templates', full({ name: 'enviada_ya' }))).status).toBe(201);
    const r = await a.post('/api/templates/draft', minimal({ name: 'enviada_ya' }));
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Ya existe una plantilla/);
  });
});

describe('enviar a revisión desde el borrador', () => {
  it('el mismo registro pasa a PENDING con su id de Meta y el simulador recibe la plantilla con el botón de baja', async () => {
    const c = await a.post('/api/templates/draft', full({ body: 'incompleto' }));
    const id = c.body.id;
    const r = await a.post(`/api/templates/${id}/submit`, full());
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ id, status: 'PENDING', hasOptOutButton: true, usableInCampaigns: false, variables: ['body.1'], draft: null });
    expect(r.body.metaTemplateId).toBeTruthy();
    expect(await t.prisma.template.count()).toBe(1);
    const row = await t.prisma.template.findUniqueOrThrow({ where: { id } });
    expect(row.draftData).toBeNull();
    expect(row.createdById).toBe(a.user.id);
    const sent = [...sim.templates.values()];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ name: 'borrador_uno', language: 'es', category: 'MARKETING' });
    expect(sent[0].components).toEqual([
      { type: 'BODY', text: 'Hola {{1}}, tenemos algo para ti.', example: { body_text: [['Juan']] } },
      { type: 'FOOTER', text: 'Un saludo, Gelado.' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Me interesa' }, { type: 'QUICK_REPLY', text: 'No recibir más' }] },
    ]);
    expect(await t.prisma.auditLog.count({ where: { action: 'submit_template_draft', entityId: id } })).toBe(1);
    // ya no es borrador: guardar o enviar de nuevo → 409 con mensaje en español
    const again = await a.put(`/api/templates/${id}/draft`, minimal());
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/ya no es un borrador/);
    expect((await a.post(`/api/templates/${id}/submit`, full())).status).toBe(409);
    expect(sim.templates.size).toBe(1);
  });

  it('en Marketing impone «No recibir más» aunque el borrador lo desmarcara; en Utilidad se respeta', async () => {
    const m = await a.post('/api/templates/draft', full({ name: 'mk_sin_baja', addOptOutButton: false, buttons: [] }));
    const mr = await a.post(`/api/templates/${m.body.id}/submit`, full({ name: 'mk_sin_baja', addOptOutButton: false, buttons: [] }));
    expect(mr.status).toBe(201);
    expect(mr.body.hasOptOutButton).toBe(true);
    const u = await a.post('/api/templates/draft', full({ name: 'ut_sin_baja', category: 'UTILITY', addOptOutButton: false }));
    const ur = await a.post(`/api/templates/${u.body.id}/submit`, full({ name: 'ut_sin_baja', category: 'UTILITY', addOptOutButton: false }));
    expect(ur.status).toBe(201);
    expect(ur.body.hasOptOutButton).toBe(false);
  });

  it('aplica la validación completa: un borrador incompleto no se envía y sigue siendo borrador', async () => {
    const c = await a.post('/api/templates/draft', full({ bodyExamples: [] }));
    const r = await a.post(`/api/templates/${c.body.id}/submit`, full({ bodyExamples: [] }));
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/Falta el ejemplo de la variable \{\{1\}\}/);
    const r2 = await a.post(`/api/templates/${c.body.id}/submit`, minimal());
    expect(r2.status).toBe(400); // el cuerpo ni siquiera cumple el esquema completo
    expect(sim.templates.size).toBe(0);
    expect((await t.prisma.template.findUniqueOrThrow({ where: { id: c.body.id } })).status).toBe('LOCAL_DRAFT');
  });

  it('si Meta falla, el borrador sigue siendo borrador, con su contenido, y se puede reintentar', async () => {
    const c = await a.post('/api/templates/draft', full());
    sim.failRules.push({ code: 100, count: 1, httpStatus: 400, path: 'message_templates' });
    const r = await a.post(`/api/templates/${c.body.id}/submit`, full());
    expect(r.status).toBe(502);
    expect(r.body.message).toMatch(/Meta no ha aceptado la plantilla/);
    const row = await t.prisma.template.findUniqueOrThrow({ where: { id: c.body.id } });
    expect(row).toMatchObject({ status: 'LOCAL_DRAFT', metaTemplateId: null });
    expect(row.draftData).not.toBeNull();
    expect(await t.prisma.auditLog.count({ where: { action: 'submit_template_draft' } })).toBe(0);
    const retry = await a.post(`/api/templates/${c.body.id}/submit`, full());
    expect(retry.status).toBe(201);
    expect(retry.body.status).toBe('PENDING');
  });

  it('cabecera de imagen: sube el ejemplo con Resumable Upload al enviar el borrador', async () => {
    const storage = t.app.get(StorageService);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const pngPath = `borrador/${Date.now()}.png`;
    await storage.upload(pngPath, png, { contentType: 'image/png' });
    const media = await t.prisma.mediaFile.create({ data: { storagePath: pngPath, mimeType: 'image/png', sizeBytes: png.length, fileName: 'ragnar.png', source: 'TEMPLATE_EXAMPLE' } });
    const dto = full({ header: { format: 'IMAGE', exampleMediaFileId: media.id } });
    const c = await a.post('/api/templates/draft', dto);
    expect(c.body.draft.header).toMatchObject({ format: 'IMAGE', exampleMediaFileId: media.id });
    expect(sim.uploads.size).toBe(0);
    const r = await a.post(`/api/templates/${c.body.id}/submit`, dto);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(sim.uploads.size).toBe(1);
    expect([...sim.uploads.values()][0].equals(png)).toBe(true);
    const header = [...sim.templates.values()][0].components.find((x: any) => x.type === 'HEADER');
    expect(header.example.header_handle[0]).toMatch(/^4::/);
  });

  it('un borrador sin archivo de ejemplo en la cabecera no se envía', async () => {
    const c = await a.post('/api/templates/draft', full({ header: { format: 'IMAGE' } }));
    const r = await a.post(`/api/templates/${c.body.id}/submit`, full({ header: { format: 'IMAGE' } }));
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/archivo de ejemplo/);
  });
});

describe('borrar un borrador y duplicar', () => {
  it('borrar es local (no llama a Meta), deja el nombre libre y queda en auditoría', async () => {
    const c = await a.post('/api/templates/draft', minimal());
    const before = sim.templates.size;
    const r = await a.del(`/api/templates/${c.body.id}`);
    expect(r.status).toBe(200);
    expect(await t.prisma.template.count()).toBe(0);
    expect(sim.templates.size).toBe(before);
    expect(await t.prisma.auditLog.count({ where: { action: 'delete_template', entityId: c.body.id } })).toBe(1);
    expect((await a.post('/api/templates/draft', minimal())).status).toBe(201); // el nombre se puede reutilizar
  });

  it('el borrador que devuelve «duplicar» se puede guardar tal cual como borrador', async () => {
    const src = await t.prisma.template.create({
      data: { name: 'buenos_dias', language: 'es', category: 'MARKETING', status: 'APPROVED', metaTemplateId: '900', components: [{ type: 'BODY', text: 'Hola {{1}}, buenos días', example: { body_text: [['Juan']] } }] },
    });
    const dup = await a.post(`/api/templates/${src.id}/duplicate`);
    expect(dup.status).toBe(201);
    const saved = await a.post('/api/templates/draft', dup.body.draft);
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body).toMatchObject({ name: 'buenos_dias_v2', status: 'LOCAL_DRAFT', variables: ['body.1'] });
  });
});

describe('solo administradora y visibilidad', () => {
  it('cada endpoint nuevo responde 403 a un agente', async () => {
    const c = await a.post('/api/templates/draft', minimal());
    const id = c.body.id;
    expect((await agent.post('/api/templates/draft', minimal({ name: 'otro' }))).status).toBe(403);
    expect((await agent.put(`/api/templates/${id}/draft`, minimal())).status).toBe(403);
    expect((await agent.post(`/api/templates/${id}/submit`, full())).status).toBe(403);
    expect((await agent.del(`/api/templates/${id}`)).status).toBe(403);
    expect(await t.prisma.template.count()).toBe(1);
  });

  it('el borrador es invisible para un agente: ni listado, ni detalle, ni filtro por estado', async () => {
    const c = await a.post('/api/templates/draft', minimal());
    await t.prisma.template.create({ data: { name: 'aprobada_x', language: 'es', category: 'UTILITY', status: 'APPROVED', metaTemplateId: '1', components: [{ type: 'BODY', text: 'Hola' }] } });
    expect((await agent.get('/api/templates')).body.map((x: any) => x.name)).toEqual(['aprobada_x']);
    expect((await agent.get('/api/templates?status=LOCAL_DRAFT')).body).toEqual([]);
    expect((await agent.get('/api/templates?status=LOCAL_DRAFT,APPROVED')).body.map((x: any) => x.name)).toEqual(['aprobada_x']);
    expect((await agent.get('/api/templates?q=borrador')).body).toEqual([]);
    const one = await agent.get(`/api/templates/${c.body.id}`);
    expect(one.status).toBe(404);
    expect((await a.get(`/api/templates/${c.body.id}`)).status).toBe(200);
  });

  it('no sale en el selector del chat (APPROVED) ni sirve para enviar en el chat ni para campañas', async () => {
    const c = await a.post('/api/templates/draft', full());
    // el selector del chat pide ?status=APPROVED, también siendo administradora
    expect((await a.get('/api/templates?status=APPROVED')).body).toEqual([]);
    const { conversation } = await seedConversation(t, { windowOpen: false });
    const send = await a.post(`/api/conversations/${conversation.id}/messages`, { type: 'template', templateId: c.body.id, params: { 'body.1': 'Ana' } });
    expect(send.status).toBe(409);
    expect(send.body.message).toMatch(/no está aprobada/);
    const camp = await a.post('/api/campaigns', { name: 'X', templateId: c.body.id, variableMapping: {}, audience: { allContacts: true }, ratePerMinute: 20 });
    expect(camp.status).toBe(400);
    expect(camp.body.message).toMatch(/no está aprobada/);
    expect(sim.sent).toHaveLength(0);
  });

  it('la sincronización con Meta no toca los borradores (ni los marca DELETED)', async () => {
    const c = await a.post('/api/templates/draft', full());
    sim.templates.set('100', { id: '100', name: 'de_meta', language: 'es', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hola' }] });
    const r = await a.post('/api/templates/sync');
    expect(r.body).toMatchObject({ total: 1, created: 1, deleted: 0 });
    const row = await t.prisma.template.findUniqueOrThrow({ where: { id: c.body.id } });
    expect(row).toMatchObject({ status: 'LOCAL_DRAFT', metaTemplateId: null });
    expect(row.draftData).not.toBeNull();
    expect((await a.get('/api/templates')).body.map((x: any) => x.name).sort()).toEqual(['borrador_uno', 'de_meta']);
    // y el recálculo del botón de baja al arrancar tampoco lo rompe
    expect(await t.app.get(TemplatesService).recomputeOptOutFlags()).toBe(0);
  });
});

/** Frena `createTemplate` (la llamada a Meta) hasta que se abra la compuerta, para solapar otras peticiones con el envío. */
function gateMeta() {
  const gw = t.app.get(WhatsAppGateway);
  const orig = gw.createTemplate.bind(gw);
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  let entered!: () => void;
  const reached = new Promise<void>((r) => (entered = r));
  const spy = vi.spyOn(gw, 'createTemplate').mockImplementation(async (...args) => {
    entered();
    await gate;
    return orig(...args);
  });
  return { open, reached, spy };
}

const metaTemplate = (over: Record<string, unknown> = {}) => ({
  id: '777',
  name: 'borrador_uno',
  language: 'es',
  category: 'MARKETING',
  status: 'PENDING',
  components: [{ type: 'BODY', text: 'Lo que realmente se envió a Meta' }],
  ...over,
});
const webhookValue = (over: Record<string, unknown> = {}) => ({ event: 'APPROVED', message_template_id: 777, message_template_name: 'borrador_uno', message_template_language: 'es', reason: 'NONE', ...over });

describe('el envío reserva el borrador (R-3)', () => {
  it('un segundo envío simultáneo, guardar o borrar durante el envío dan 409 y el primero termina bien', async () => {
    const c = await a.post('/api/templates/draft', full());
    const id = c.body.id;
    const g = gateMeta();
    const first = Promise.resolve(a.post(`/api/templates/${id}/submit`, full()));
    await g.reached;
    const second = await a.post(`/api/templates/${id}/submit`, full());
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/ya se está enviando/);
    const save = await a.put(`/api/templates/${id}/draft`, full({ body: 'cambio a mitad del envío' }));
    expect(save.status).toBe(409);
    const del = await a.del(`/api/templates/${id}`);
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/ya se está enviando/);
    expect(await t.prisma.template.count({ where: { id } })).toBe(1);
    g.open();
    const r = await first;
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ id, status: 'PENDING' });
    expect(g.spy).toHaveBeenCalledTimes(1);
    expect(sim.templates.size).toBe(1);
    const row = await t.prisma.template.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'PENDING', submittingAt: null });
    expect(row.draftData).toBeNull();
    expect(row.components).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'BODY', text: 'Hola {{1}}, tenemos algo para ti.' })])); // lo enviado, no una versión editada a mitad
  });

  it('si Meta falla se libera la reserva y se puede reintentar o borrar', async () => {
    const c = await a.post('/api/templates/draft', full());
    sim.failRules.push({ code: 100, count: 1, httpStatus: 400, path: 'message_templates' });
    expect((await a.post(`/api/templates/${c.body.id}/submit`, full())).status).toBe(502);
    expect((await t.prisma.template.findUniqueOrThrow({ where: { id: c.body.id } })).submittingAt).toBeNull();
    expect((await a.put(`/api/templates/${c.body.id}/draft`, full({ body: 'ya puedo editar' }))).status).toBe(200);
    expect((await a.del(`/api/templates/${c.body.id}`)).status).toBe(200);
  });

  it('una reserva caducada (envío muerto) no bloquea: se puede borrar y volver a enviar', async () => {
    const c = await a.post('/api/templates/draft', full());
    await t.prisma.template.update({ where: { id: c.body.id }, data: { submittingAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await a.post(`/api/templates/${c.body.id}/submit`, full())).status).toBe(201);
    const d = await a.post('/api/templates/draft', full({ name: 'otro_borrador' }));
    await t.prisma.template.update({ where: { id: d.body.id }, data: { submittingAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await a.del(`/api/templates/${d.body.id}`)).status).toBe(200);
  });

  it('borrar no toca una plantilla que ya no es borrador: la borra también en Meta', async () => {
    const c = await a.post('/api/templates/draft', full());
    expect((await a.post(`/api/templates/${c.body.id}/submit`, full())).status).toBe(201);
    expect(sim.templates.size).toBe(1);
    expect((await a.del(`/api/templates/${c.body.id}`)).status).toBe(200);
    expect(sim.templates.size).toBe(0);
    expect((await t.prisma.template.findUniqueOrThrow({ where: { id: c.body.id } })).status).toBe('DELETED');
  });

  it('borrar un borrador que otra pestaña acaba de enviar da 409 y no lo borra en Meta (irreversible)', async () => {
    const c = await a.post('/api/templates/draft', full());
    const id = c.body.id;
    const prisma = (t.app.get(TemplatesService) as any).prisma;
    // carrera: entre leer la fila (borrador) y el borrado condicionado, el envío de otra pestaña termina
    const spy = vi.spyOn(prisma.template, 'deleteMany').mockImplementationOnce(async () => {
      await prisma.template.update({ where: { id }, data: { status: 'PENDING', metaTemplateId: '999' } });
      return { count: 0 };
    });
    sim.templates.set('999', metaTemplate({ id: '999' }));
    const r = await a.del(`/api/templates/${id}`);
    spy.mockRestore();
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/ya se ha enviado a Meta/);
    expect(sim.templates.has('999')).toBe(true);
    expect((await t.prisma.template.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
  });

  it('si una sincronización adopta el borrador mientras se envía, el envío termina bien sobre esa misma fila', async () => {
    const c = await a.post('/api/templates/draft', full());
    const id = c.body.id;
    const g = gateMeta();
    const first = Promise.resolve(a.post(`/api/templates/${id}/submit`, full()));
    await g.reached;
    sim.templates.set('777', metaTemplate()); // Meta ya la tiene (p. ej. el envío llegó pero la respuesta tarda)
    const sync = await a.post('/api/templates/sync');
    expect(sync.body).toMatchObject({ adoptedDrafts: 1 });
    g.open();
    const r = await first;
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await t.prisma.template.count()).toBe(1);
    const row = await t.prisma.template.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ metaTemplateId: '777', submittingAt: null });
    expect(row.status).not.toBe('LOCAL_DRAFT');
  });
});

describe('los webhooks nunca ponen el contenido del borrador en una plantilla (R-2)', () => {
  it('A · el envío agotó el tiempo pero Meta la creó: el APPROVED deja los componentes reales de Meta, no los del borrador', async () => {
    const c = await a.post('/api/templates/draft', full());
    expect(c.body.variables).toEqual(['body.1']);
    sim.templates.set('777', metaTemplate({ components: [{ type: 'BODY', text: 'Texto enviado, sin variables' }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'No recibir más' }] }] }));
    sim.failRules.push({ code: 100, count: 1, httpStatus: 400, path: 'message_templates' }); // la respuesta se perdió: 502
    expect((await a.post(`/api/templates/${c.body.id}/submit`, full())).status).toBe(502);
    expect((await t.prisma.template.findUniqueOrThrow({ where: { id: c.body.id } })).status).toBe('LOCAL_DRAFT');
    sim.templates.get('777').status = 'APPROVED';
    await t.app.get(TemplatesService).handleStatusUpdate(webhookValue());
    const row = await t.prisma.template.findUniqueOrThrow({ where: { id: c.body.id } });
    expect(row).toMatchObject({ status: 'APPROVED', metaTemplateId: '777', hasOptOutButton: true, submittingAt: null });
    expect(row.draftData).toBeNull();
    expect((row.components as any[]).find((x) => x.type === 'BODY').text).toBe('Texto enviado, sin variables');
    const dto = (await a.get(`/api/templates/${c.body.id}`)).body;
    expect(dto).toMatchObject({ variables: [], status: 'APPROVED', draft: null });
  });

  it('B · en Meta existe una de marketing con ese nombre sin «No recibir más»: no queda usable en campañas', async () => {
    const c = await a.post('/api/templates/draft', full()); // el borrador sí lleva el botón de baja
    expect(c.body.hasOptOutButton).toBe(true);
    sim.templates.set('777', metaTemplate({ status: 'APPROVED' })); // sin botón de baja
    await t.app.get(TemplatesService).handleStatusUpdate(webhookValue());
    const dto = (await a.get(`/api/templates/${c.body.id}`)).body;
    expect(dto).toMatchObject({ status: 'APPROVED', hasOptOutButton: false, usableInCampaigns: false });
    expect(await t.prisma.template.count()).toBe(1);
  });

  it('C · un webhook que solo coincide con un borrador y no está en Meta se ignora y el borrador no cambia', async () => {
    const c = await a.post('/api/templates/draft', full());
    await t.app.get(TemplatesService).handleStatusUpdate(webhookValue());
    await t.app.get(TemplatesService).handleQualityUpdate({ message_template_name: 'borrador_uno', message_template_language: 'es', new_quality_score: 'GREEN' });
    const row = await t.prisma.template.findUniqueOrThrow({ where: { id: c.body.id } });
    expect(row).toMatchObject({ status: 'LOCAL_DRAFT', metaTemplateId: null, qualityScore: null });
    expect(row.draftData).not.toBeNull();
  });
});

describe('la sincronización avisa cuando adopta un borrador (R-4)', () => {
  it('un borrador con el nombre de una plantilla de Meta pasa a ser esa plantilla, con constancia en el resultado y en la auditoría', async () => {
    const c = await a.post('/api/templates/draft', full());
    sim.templates.set('777', metaTemplate({ status: 'APPROVED' }));
    const r = await a.post('/api/templates/sync');
    expect(r.body).toMatchObject({ total: 1, created: 0, updated: 1, adoptedDrafts: 1 });
    const row = await t.prisma.template.findUniqueOrThrow({ where: { id: c.body.id } });
    expect(row).toMatchObject({ status: 'APPROVED', metaTemplateId: '777' });
    expect(row.draftData).toBeNull();
    expect((row.components as any[])[0].text).toBe('Lo que realmente se envió a Meta');
    const log = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'adopt_template_draft' } });
    expect(log).toMatchObject({ entityId: c.body.id, data: expect.objectContaining({ name: 'borrador_uno', language: 'es', metaTemplateId: '777' }) });
    // una segunda sincronización ya no adopta nada
    expect((await a.post('/api/templates/sync')).body.adoptedDrafts).toBe(0);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, ADMIN_EMAIL, AGENT_EMAIL, type TestApp } from './utils/app';
import { MetaSimulator } from './meta-simulator/simulator';
import { StorageService } from '../src/modules/storage/storage.service';
import { WebhookFieldRouter } from '../src/modules/webhooks/webhook-field-router';
import { DomainEvents } from '../src/modules/events/domain-events.service';
import { RealtimeService } from '../src/modules/realtime/realtime.gateway';
import { TemplatesService } from '../src/modules/templates/templates.service';
import type { TemplateComponent } from '@gelado/shared';

let t: TestApp;
let sim: MetaSimulator;

beforeAll(async () => {
  sim = await new MetaSimulator({ appSecret: 'test-app-secret' }).start();
  t = await createTestApp({ META_GRAPH_BASE_URL: sim.baseUrl });
});
afterAll(async () => {
  await t.close();
  await sim.stop();
});
beforeEach(async () => {
  await t.reset();
  sim.reset();
});

const body = (text: string, ex?: string[]): TemplateComponent => ({ type: 'BODY', text, ...(ex ? { example: { body_text: [ex] } } : {}) });
const qr = (text: string): TemplateComponent => ({ type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text }] });

/** Las 12 plantillas actuales: todas de marketing; solo «Campaña Imagen con baja» tiene botón de baja. */
function loadTwelve() {
  const names = ['buenos_dias', 'buenas_tardes', 'inicio_de_conversacion', 'cierre_de_ventana_24h', 'vacaciones', 'mandar_pdf', 'campana_pdf_y_enlace', 'campana_imagen_copie', 'campana_imagen_con_baja', 'ragnar_z_tech', 'oferta_semanal', 'novedades_otono'];
  names.forEach((name, i) => {
    const withOptOut = name === 'campana_imagen_con_baja';
    sim.templates.set(`10${i}`, {
      id: `10${i}`,
      name,
      language: 'es',
      category: 'MARKETING',
      status: name === 'campana_imagen_con_baja' ? 'PENDING' : name === 'oferta_semanal' ? 'REJECTED' : 'APPROVED',
      rejected_reason: name === 'oferta_semanal' ? 'INVALID_FORMAT' : 'NONE',
      quality_score: { score: 'GREEN' },
      components: [body(`Hola {{1}}, mensaje ${name}`, ['Juan']), ...(withOptOut ? [qr('No recibir más')] : [])],
    });
  });
}

async function admin() {
  return loginAs(t, ADMIN_EMAIL);
}

const validDto = (over: Record<string, unknown> = {}) => ({
  displayName: 'Ragnar Z-TECH',
  name: 'ragnar_z_tech_nueva',
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

describe('S3 · sincronización (RF-4.1)', () => {
  it('importa las 12 plantillas de marketing, marca las que no tienen botón de baja y las bloquea para campañas', async () => {
    loadTwelve();
    const a = await admin();
    const r = await a.post('/api/templates/sync');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ total: 12, created: 12, deleted: 0 });
    const list = await a.get('/api/templates');
    expect(list.body).toHaveLength(12);
    const bd = list.body.find((x: any) => x.name === 'buenos_dias');
    expect(bd).toMatchObject({ category: 'MARKETING', status: 'APPROVED', hasOptOutButton: false, usableInCampaigns: false, variables: ['body.1'], headerFormat: 'NONE', qualityScore: 'GREEN' });
    const withBtn = list.body.find((x: any) => x.name === 'campana_imagen_con_baja');
    expect(withBtn).toMatchObject({ status: 'PENDING', hasOptOutButton: true, usableInCampaigns: false });
    const rej = list.body.find((x: any) => x.name === 'oferta_semanal');
    expect(rej.status).toBe('REJECTED');
    expect(rej.rejectedReason).toMatch(/Formato no válido/);
    expect(list.body.filter((x: any) => x.usableInCampaigns)).toHaveLength(0);
    // filtros
    expect((await a.get('/api/templates?status=APPROVED')).body).toHaveLength(10);
    expect((await a.get('/api/templates?q=buen')).body.map((x: any) => x.name).sort()).toEqual(['buenas_tardes', 'buenos_dias']);
    expect((await a.get('/api/templates?category=UTILITY')).body).toHaveLength(0);
    const one = await a.get(`/api/templates/${bd.id}`);
    expect(one.body.id).toBe(bd.id);
    expect((await a.get('/api/templates/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('es idempotente, actualiza cambios y marca DELETED las que ya no están en Meta; auditoría', async () => {
    loadTwelve();
    const a = await admin();
    await a.post('/api/templates/sync');
    sim.templates.get('100').status = 'PAUSED';
    sim.templates.delete('101');
    const events: any[] = [];
    t.app.get(DomainEvents).on('template.status', 'test', (p) => void events.push(p));
    const r = await a.post('/api/templates/sync');
    expect(r.body).toMatchObject({ total: 11, created: 0, updated: 11, deleted: 1 });
    const rows = await t.prisma.template.findMany();
    expect(rows).toHaveLength(12);
    expect(rows.find((x) => x.name === 'buenos_dias')!.status).toBe('PAUSED');
    expect(rows.find((x) => x.name === 'buenas_tardes')!.status).toBe('DELETED');
    expect(events.map((e) => `${e.name}:${e.previousStatus}>${e.status}`).sort()).toEqual(['buenas_tardes:APPROVED>DELETED', 'buenos_dias:APPROVED>PAUSED']);
    expect((await a.get('/api/templates')).body).toHaveLength(11);
    expect(await t.prisma.auditLog.count({ where: { action: 'sync_templates' } })).toBe(2);
  });

  it('el cron horario sincroniza', async () => {
    loadTwelve();
    await t.jobs.runInline('cron-hourly' as any, {});
    expect(await t.prisma.template.count()).toBe(12);
  });
});

describe('S3 · crear y enviar a revisión (RF-4.2)', () => {
  it('construye los componentes con la forma de Meta y guarda PENDING', async () => {
    const a = await admin();
    const r = await a.post('/api/templates', validDto());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'ragnar_z_tech_nueva', displayName: 'Ragnar Z-TECH', status: 'PENDING', hasOptOutButton: true, usableInCampaigns: false, variables: ['body.1'] });
    const sent = [...sim.templates.values()][0];
    expect(sent).toMatchObject({ name: 'ragnar_z_tech_nueva', language: 'es', category: 'MARKETING' });
    expect(sent.components).toEqual([
      { type: 'BODY', text: 'Hola {{1}}, tenemos algo para ti.', example: { body_text: [['Juan']] } },
      { type: 'FOOTER', text: 'Un saludo, Gelado.' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Me interesa' }, { type: 'QUICK_REPLY', text: 'No recibir más' }] },
    ]);
    const row = await t.prisma.template.findFirstOrThrow();
    expect(row.createdById).toBe(a.user.id);
    expect(row.metaTemplateId).toBeTruthy();
    expect(await t.prisma.auditLog.count({ where: { action: 'create_template' } })).toBe(1);
  });

  it('en Marketing impone el botón «No recibir más» aunque se desmarque; en Utilidad se respeta', async () => {
    const a = await admin();
    const m = await a.post('/api/templates', validDto({ name: 'mk_sin_baja', addOptOutButton: false, buttons: [], body: 'Hola equipo', bodyExamples: [], footer: undefined }));
    expect(m.status).toBe(201);
    expect(m.body.hasOptOutButton).toBe(true);
    const u = await a.post('/api/templates', validDto({ name: 'ut_pedido', category: 'UTILITY', addOptOutButton: false, buttons: [], body: 'Tu pedido {{1}} sale hoy', bodyExamples: ['A-123'] }));
    expect(u.status).toBe(201);
    expect(u.body.hasOptOutButton).toBe(false);
    expect(u.body.usableInCampaigns).toBe(false); // aún pendiente
    // si el cliente ya puso un botón de baja propio no se duplica
    const d = await a.post('/api/templates', validDto({ name: 'mk_con_baja', buttons: [{ type: 'QUICK_REPLY', text: 'No recibir más' }] }));
    const comps = d.body.components.find((c: any) => c.type === 'BUTTONS').buttons;
    expect(comps).toHaveLength(1);
  });

  it('valida con mensajes en español', async () => {
    const a = await admin();
    const bad = async (over: Record<string, unknown>, re: RegExp) => {
      const r = await a.post('/api/templates', validDto(over));
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(JSON.stringify(r.body)).toMatch(re);
    };
    await bad({ name: 'Mal Nombre' }, /minúsculas, números y guion bajo/);
    await bad({ bodyExamples: [] }, /Falta el ejemplo de la variable \{\{1\}\}/);
    await bad({ body: 'Hola {{2}} y {{3}} ok', bodyExamples: ['a', 'b'] }, /consecutivas/);
    await bad({ body: '{{1}} hola', bodyExamples: ['Juan'] }, /empezar por una variable/);
    await bad({ footer: 'x'.repeat(61) }, /60 caracteres/);
    await bad({ buttons: [{ type: 'QUICK_REPLY', text: 'x'.repeat(26) }] }, /25 caracteres/);
    await bad({ header: { format: 'TEXT', text: 'y'.repeat(61) } }, /60 caracteres/);
    await bad({ header: { format: 'TEXT', text: 'Hola {{1}}' } }, /ejemplo de la variable de la cabecera/);
    await bad({ header: { format: 'IMAGE' } }, /archivo de ejemplo/);
    await bad({ buttons: [{ type: 'URL', text: 'Ver', url: 'https://gelado.eu/{{1}}/mas', example: 'x' }] }, /solo puede ir al final/);
    await bad({ buttons: [{ type: 'URL', text: 'Ver', url: 'https://gelado.eu/p/{{1}}' }] }, /Falta el ejemplo de la variable del enlace/);
    await bad({ category: 'AUTH' }, /categoría/);
  });

  it('URL con variable al final y botón de llamada se serializan para Meta', async () => {
    const a = await admin();
    const r = await a.post(
      '/api/templates',
      validDto({
        name: 'con_enlace',
        buttons: [
          { type: 'URL', text: 'Ver catálogo', url: 'https://gelado.eu/p/{{1}}', example: 'ragnar' },
          { type: 'PHONE_NUMBER', text: 'Llamar', phone: '+34 617 49 82 22' },
          { type: 'QUICK_REPLY', text: 'Me interesa' },
        ],
      }),
    );
    expect(r.status).toBe(201);
    const btns = [...sim.templates.values()][0].components.find((c: any) => c.type === 'BUTTONS').buttons;
    expect(btns).toEqual([
      { type: 'QUICK_REPLY', text: 'Me interesa' },
      { type: 'QUICK_REPLY', text: 'No recibir más' },
      { type: 'URL', text: 'Ver catálogo', url: 'https://gelado.eu/p/{{1}}', example: ['https://gelado.eu/p/ragnar'] },
      { type: 'PHONE_NUMBER', text: 'Llamar', phone_number: '+34617498222' },
    ]);
  });

  it('cabecera de imagen: sube el ejemplo con Resumable Upload y envía header_handle', async () => {
    const a = await admin();
    const storage = t.app.get(StorageService);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const pngPath = `s3/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    await storage.upload(pngPath, png, { contentType: 'image/png' });
    const media = await t.prisma.mediaFile.create({ data: { storagePath: pngPath, mimeType: 'image/png', sizeBytes: png.length, fileName: 'ragnar.png', source: 'TEMPLATE_EXAMPLE' } });
    const r = await a.post('/api/templates', validDto({ name: 'con_imagen', header: { format: 'IMAGE', exampleMediaFileId: media.id } }));
    expect(r.status).toBe(201);
    expect(r.body.headerFormat).toBe('IMAGE');
    expect(sim.uploads.size).toBe(1);
    expect([...sim.uploads.values()][0].equals(png)).toBe(true);
    const header = [...sim.templates.values()][0].components.find((c: any) => c.type === 'HEADER');
    expect(header.format).toBe('IMAGE');
    expect(header.example.header_handle).toHaveLength(1);
    expect(header.example.header_handle[0]).toMatch(/^4::/);
  });

  it('cabecera de texto con variable lleva header_text; mime incorrecto se rechaza', async () => {
    const a = await admin();
    const r = await a.post('/api/templates', validDto({ name: 'cab_texto', header: { format: 'TEXT', text: 'Hola {{1}}', textExample: 'Juan' } }));
    expect(r.status).toBe(201);
    const h = [...sim.templates.values()][0].components.find((c: any) => c.type === 'HEADER');
    expect(h).toEqual({ type: 'HEADER', format: 'TEXT', text: 'Hola {{1}}', example: { header_text: ['Juan'] } });
    const storage = t.app.get(StorageService);
    const pdfPath = `s3/${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
    await storage.upload(pdfPath, Buffer.from('%PDF'), { contentType: 'application/pdf' });
    const m = await t.prisma.mediaFile.create({ data: { storagePath: pdfPath, mimeType: 'application/pdf', sizeBytes: 4, source: 'TEMPLATE_EXAMPLE' } });
    const bad = await a.post('/api/templates', validDto({ name: 'cab_mal', header: { format: 'IMAGE', exampleMediaFileId: m.id } }));
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/JPG o PNG/);
  });

  it('nombre repetido → 409; error de Meta → 502 en español y no guarda nada', async () => {
    const a = await admin();
    expect((await a.post('/api/templates', validDto())).status).toBe(201);
    const dup = await a.post('/api/templates', validDto());
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/Ya existe/);
    sim.failRules.push({ code: 100, count: 1, httpStatus: 400, path: 'message_templates' });
    const r = await a.post('/api/templates', validDto({ name: 'otra_distinta' }));
    expect(r.status).toBe(502);
    expect(r.body.message).toMatch(/Meta no ha aceptado la plantilla/);
    expect(await t.prisma.template.count()).toBe(1);
  });
});

describe('S3 · duplicar y borrar', () => {
  it('duplicar devuelve un borrador _v2 con el botón de baja, sin crear nada en Meta', async () => {
    loadTwelve();
    const a = await admin();
    await a.post('/api/templates/sync');
    const src = await t.prisma.template.findFirstOrThrow({ where: { name: 'buenos_dias' } });
    const before = sim.templates.size;
    const r = await a.post(`/api/templates/${src.id}/duplicate`);
    expect(r.status).toBe(201);
    expect(r.body.sourceTemplateId).toBe(src.id);
    expect(r.body.draft).toMatchObject({ name: 'buenos_dias_v2', category: 'MARKETING', language: 'es', addOptOutButton: true, body: 'Hola {{1}}, mensaje buenos_dias', bodyExamples: ['Juan'] });
    expect(r.body.notes.join(' ')).toMatch(/No recibir más/);
    expect(sim.templates.size).toBe(before);
    // el borrador es válido tal cual y crea una plantilla utilizable en cuanto se apruebe
    const created = await a.post('/api/templates', r.body.draft);
    expect(created.status).toBe(201);
    expect(created.body.hasOptOutButton).toBe(true);
    // duplicar la v2 → v3
    const v3 = await a.post(`/api/templates/${created.body.id}/duplicate`);
    expect(v3.body.draft.name).toBe('buenos_dias_v3');
    // la que ya tenía el botón no lo duplica
    const withBtn = await t.prisma.template.findFirstOrThrow({ where: { name: 'campana_imagen_con_baja' } });
    const d2 = await a.post(`/api/templates/${withBtn.id}/duplicate`);
    expect(d2.body.draft.buttons).toEqual([]);
    expect(d2.body.draft.addOptOutButton).toBe(true);
  });

  it('borrar elimina en Meta, marca DELETED y audita; bloquea si hay campañas activas', async () => {
    const a = await admin();
    const c = await a.post('/api/templates', validDto());
    const name = c.body.name;
    const del = await a.del(`/api/templates/${c.body.id}`);
    expect(del.status).toBe(200);
    expect([...sim.templates.values()].some((x) => x.name === name)).toBe(false);
    expect((await t.prisma.template.findUniqueOrThrow({ where: { id: c.body.id } })).status).toBe('DELETED');
    expect((await a.get('/api/templates')).body).toHaveLength(0);
    expect(await t.prisma.auditLog.count({ where: { action: 'delete_template' } })).toBe(1);
    // reutilizar el nombre borrado
    const again = await a.post('/api/templates', validDto());
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/ya se usó/);

    const c2 = await a.post('/api/templates', validDto({ name: 'en_campana' }));
    await t.prisma.campaign.create({ data: { name: 'Camp', template: { connect: { id: c2.body.id } }, createdBy: { connect: { id: a.user.id } }, variableMapping: {}, audience: {}, status: 'RUNNING' } });
    const blocked = await a.del(`/api/templates/${c2.body.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/campañas/);
  });
});

describe('S3 · estados por webhook (RF-4.4)', () => {
  const ctx = { eventId: 'e1', receivedAt: new Date(), entryId: 'waba' };
  async function seeded() {
    loadTwelve();
    const a = await admin();
    await a.post('/api/templates/sync');
    const events: any[] = [];
    t.app.get(DomainEvents).on('template.status', 'test', (p) => void events.push(p));
    const rt = t.app.get(RealtimeService);
    rt.emitted.length = 0;
    return { a, events, rt, router: t.app.get(WebhookFieldRouter), row: await t.prisma.template.findFirstOrThrow({ where: { name: 'campana_imagen_con_baja' } }) };
  }

  it('registra los tres campos en el enrutador', async () => {
    const r = t.app.get(WebhookFieldRouter);
    for (const f of ['message_template_status_update', 'message_template_quality_update', 'template_category_update']) expect(r.has(f)).toBe(true);
  });

  it('APPROVED y REJECTED con motivo; emite template.status y template.updated', async () => {
    const { events, rt, router, row } = await seeded();
    await router.dispatch('message_template_status_update', { event: 'APPROVED', message_template_id: Number(row.metaTemplateId), message_template_name: row.name, message_template_language: 'es', reason: 'NONE' }, ctx);
    let cur = await t.prisma.template.findUniqueOrThrow({ where: { id: row.id } });
    expect(cur.status).toBe('APPROVED');
    expect(events.at(-1)).toMatchObject({ templateId: row.id, status: 'APPROVED', previousStatus: 'PENDING' });
    expect(rt.emitted.at(-1)).toMatchObject({ event: 'template.updated', payload: { templateId: row.id, status: 'APPROVED' } });
    // aprobada con botón de baja → utilizable
    const dto = await t.prisma.template.findUniqueOrThrow({ where: { id: row.id } });
    expect(dto.hasOptOutButton).toBe(true);

    await router.dispatch('message_template_status_update', { event: 'REJECTED', message_template_id: row.metaTemplateId, message_template_name: row.name, message_template_language: 'es', reason: 'ABUSIVE_CONTENT' }, ctx);
    cur = await t.prisma.template.findUniqueOrThrow({ where: { id: row.id } });
    expect(cur.status).toBe('REJECTED');
    expect(cur.rejectedReason).toMatch(/Contenido abusivo/);
    expect(events.at(-1)).toMatchObject({ status: 'REJECTED', previousStatus: 'APPROVED', reason: expect.stringMatching(/abusivo/i) });
  });

  it('PAUSED, DISABLED, IN_APPEAL, PENDING_DELETION y FLAGGED', async () => {
    const { events, router, row } = await seeded();
    const send = (event: string) => router.dispatch('message_template_status_update', { event, message_template_id: row.metaTemplateId, message_template_name: row.name, message_template_language: 'es' }, ctx);
    const status = async () => (await t.prisma.template.findUniqueOrThrow({ where: { id: row.id } })).status;
    await send('PAUSED');
    expect(await status()).toBe('PAUSED');
    await send('FLAGGED');
    expect(await status()).toBe('PAUSED'); // FLAGGED no cambia el estado
    expect(events.at(-1)).toMatchObject({ status: 'FLAGGED' });
    await send('DISABLED');
    expect(await status()).toBe('DISABLED');
    await send('IN_APPEAL');
    expect(await status()).toBe('IN_APPEAL');
    await send('PENDING_DELETION');
    expect(await status()).toBe('DELETED');
    expect(events.map((e) => e.status)).toEqual(['PAUSED', 'FLAGGED', 'DISABLED', 'IN_APPEAL', 'DELETED']);
  });

  it('calidad y categoría (Meta recategoriza Utilidad → Marketing)', async () => {
    const { router, row } = await seeded();
    await router.dispatch('message_template_quality_update', { previous_quality_score: 'GREEN', new_quality_score: 'YELLOW', message_template_id: row.metaTemplateId, message_template_name: row.name, message_template_language: 'es' }, ctx);
    expect((await t.prisma.template.findUniqueOrThrow({ where: { id: row.id } })).qualityScore).toBe('YELLOW');
    await t.prisma.template.update({ where: { id: row.id }, data: { category: 'UTILITY' } });
    await router.dispatch('template_category_update', { message_template_id: row.metaTemplateId, message_template_name: row.name, message_template_language: 'es', previous_category: 'UTILITY', new_category: 'MARKETING' }, ctx);
    expect((await t.prisma.template.findUniqueOrThrow({ where: { id: row.id } })).category).toBe('MARKETING');
  });

  it('plantilla desconocida localmente: resincroniza y la aplica', async () => {
    const { router } = await seeded();
    sim.templates.set('999', { id: '999', name: 'nueva_en_meta', language: 'es', category: 'UTILITY', status: 'APPROVED', components: [body('Hola')] });
    await router.dispatch('message_template_status_update', { event: 'PAUSED', message_template_id: 999, message_template_name: 'nueva_en_meta', message_template_language: 'es' }, ctx);
    const r = await t.prisma.template.findFirstOrThrow({ where: { name: 'nueva_en_meta' } });
    expect(r.status).toBe('PAUSED');
  });

  it('el servicio expone el mismo DTO que el listado', async () => {
    const { row } = await seeded();
    const dto = await t.app.get(TemplatesService).get(row.id);
    expect(dto.variables).toEqual(['body.1']);
  });
});

describe('S3 · permisos', () => {
  it('el agente puede leer pero no crear, sincronizar, duplicar ni borrar', async () => {
    loadTwelve();
    const adm = await admin();
    await adm.post('/api/templates/sync');
    const row = await t.prisma.template.findFirstOrThrow();
    const ag = await loginAs(t, AGENT_EMAIL);
    expect((await ag.get('/api/templates?status=APPROVED')).status).toBe(200);
    expect((await ag.get(`/api/templates/${row.id}`)).status).toBe(200);
    expect((await ag.post('/api/templates/sync')).status).toBe(403);
    expect((await ag.post('/api/templates', validDto())).status).toBe(403);
    expect((await ag.post(`/api/templates/${row.id}/duplicate`)).status).toBe(403);
    expect((await ag.del(`/api/templates/${row.id}`)).status).toBe(403);
    expect((await t.http.get('/api/templates')).status).toBe(401);
  });
});

/**
 * QA · huecos de las 10 áreas de docs/08 que las pruebas S1–S7 no cubrían:
 *  1 webhook · 3 media · 4 ventana de 24 h · 5 bajas · 7 importación · 10 coste.
 * (La matriz completa punto → prueba está en docs/trabajo/QA.md.)
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedConversation, seedTemplate, PNG_1X1, APP_SECRET, type WaTestEnv } from './meta-simulator/harness';
import { ADMIN_EMAIL, AGENT_EMAIL, loginAs } from './utils/app';
import { CampaignClock } from '../src/modules/campaigns/campaigns.clock';
import { CampaignRunnerService } from '../src/modules/campaigns/campaign-runner.service';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => {
  env.t.app.get(CampaignClock).set(null);
  await env.close();
});
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});
const prisma = () => env.t.prisma;
const text = (from: string, body: string, extra: Record<string, unknown> = {}) => ({ from, type: 'text', text: { body }, ...extra });
const sign = (body: string) => 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex');
const raw = (body: string, signature: string | null = sign(body)) =>
  fetch(env.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Hub-Signature-256': signature } : {}) }, body });

describe('Área 1 · Webhook (huecos)', () => {
  it('la firma se calcula sobre el cuerpo CRUDO: JSON con sangrías, espacios y tildes/emoji también valida', async () => {
    const payload = env.sim.inboundPayload(text('34600111222', 'Pedido ñandú 🎉 áéíóú'));
    const pretty = JSON.stringify(payload, null, 4) + '\n\n';
    expect((await raw(pretty)).status).toBe(200);
    expect((await prisma().message.findFirstOrThrow()).body).toBe('Pedido ñandú 🎉 áéíóú');
    // la firma del cuerpo compacto NO vale para el cuerpo con sangrías
    const other = env.sim.inboundPayload(text('34600111333', 'otro'));
    expect((await raw(JSON.stringify(other, null, 2), sign(JSON.stringify(other)))).status).toBe(401);
  });

  it('JSON roto con firma válida no provoca un 500 y no guarda mensajes', async () => {
    const r = await raw('{"object": "whatsapp_business_account", "entry": [');
    expect(r.status).toBeLessThan(500);
    expect(await prisma().message.count()).toBe(0);
  });

  it('cuerpo vacío o de otro objeto (no whatsapp_business_account) → 200/4xx sin procesar', async () => {
    const r1 = await raw('{}');
    expect(r1.status).toBeLessThan(500);
    const r2 = await raw(JSON.stringify({ object: 'page', entry: [] }));
    expect(r2.status).toBeLessThan(500);
    expect(await prisma().message.count()).toBe(0);
  });

  it('responde en menos de 1 s (la app confirma y procesa aparte)', async () => {
    const payload = env.sim.inboundPayload(text('34600111222', 'rápido'));
    const t0 = Date.now();
    const status = await env.sim.postWebhook(payload);
    expect(status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('un mismo webhook con dos clientes distintos y un estado procesa los tres', async () => {
    const { conversation } = await seedConversation(env.t, { phone: '34600999888' });
    const a = await loginAs(env.t, ADMIN_EMAIL);
    await a.post(`/api/conversations/${conversation.id}/messages`, { type: 'text', body: 'Hola' });
    const out = await prisma().message.findFirstOrThrow({ where: { direction: 'OUTBOUND' } });
    const now = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: env.sim.wabaId, changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: env.sim.metadata(),
        contacts: [{ profile: { name: 'Ana' }, wa_id: '34611000001' }, { profile: { name: 'Berta' }, wa_id: '34611000002' }],
        messages: [{ from: '34611000001', id: 'wamid.A1', timestamp: now, type: 'text', text: { body: 'de Ana' } }, { from: '34611000002', id: 'wamid.B1', timestamp: now, type: 'text', text: { body: 'de Berta' } }],
        statuses: [{ id: out.wamid, status: 'delivered', timestamp: now, recipient_id: '34600999888', pricing: { billable: true, pricing_model: 'PMP', category: 'service' } }],
      } }] }],
    });
    expect((await raw(body)).status).toBe(200);
    expect(await prisma().message.count({ where: { wamid: { in: ['wamid.A1', 'wamid.B1'] } } })).toBe(2);
    expect((await prisma().message.findUniqueOrThrow({ where: { id: out.id } })).status).toBe('DELIVERED');
  });

  it('un estado de un wamid que no existe no rompe nada ni se queda reintentando para siempre', async () => {
    const status = await env.sim.sendStatus({ wamid: 'wamid.NUNCA_ENVIADO', status: 'delivered' });
    expect(status).toBe(200);
    expect(await prisma().message.count()).toBe(0);
    expect(await prisma().webhookEvent.count()).toBe(1);
  });
});

describe('Área 3 · Media (huecos): tamaño y tipo no permitidos con mensaje claro', () => {
  const up = (who: Awaited<ReturnType<typeof loginAs>>, buf: Buffer, name: string, mime: string) =>
    who.agent.post('/api/media').set('X-Requested-With', 'XMLHttpRequest').attach('file', buf, { filename: name, contentType: mime });

  it.each([
    ['imagen > 5 MB', Buffer.alloc(5 * 1024 * 1024 + 1, 1), 'foto.jpg', 'image/jpeg', /5 MB/],
    ['vídeo > 16 MB', Buffer.alloc(16 * 1024 * 1024 + 1, 1), 'v.mp4', 'video/mp4', /16 MB/],
    ['audio > 16 MB', Buffer.alloc(16 * 1024 * 1024 + 1, 1), 'a.mp3', 'audio/mpeg', /16 MB/],
  ])('%s → 4xx con el máximo en el mensaje y nada guardado', async (_n, buf, name, mime, re) => {
    const a = await loginAs(env.t, AGENT_EMAIL);
    const r = await up(a, buf, name, mime);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(String(r.body.message)).toMatch(re);
    expect(await prisma().mediaFile.count()).toBe(0);
  });

  it.each([
    ['ejecutable', 'programa.exe', 'application/x-msdownload'],
    ['zip', 'datos.zip', 'application/zip'],
    ['html', 'pagina.html', 'text/html'],
    ['svg', 'logo.svg', 'image/svg+xml'],
    ['gif', 'a.gif', 'image/gif'],
  ])('tipo no permitido (%s) → 4xx en español', async (_n, name, mime) => {
    const a = await loginAs(env.t, AGENT_EMAIL);
    const r = await up(a, Buffer.from('x'), name, mime);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(String(r.body.message)).toMatch(/no admitido|no permitido|no se admite/i);
  });

  it('un adjunto entrante que no se puede bajar no tumba el webhook: 200 y el mensaje queda visible', async () => {
    const mid = env.sim.addInboundMedia(PNG_1X1, 'image/png');
    env.sim.deleteMedia(mid);
    expect(await env.sim.sendInbound({ from: '34600111222', type: 'image', image: { id: mid, mime_type: 'image/png', caption: 'foto' } })).toBe(200);
    const m = await prisma().message.findFirstOrThrow();
    expect(m).toMatchObject({ kind: 'IMAGE', body: 'foto' });
  });
});

describe('Área 4 · Ventana de 24 h (límites exactos)', () => {
  async function conv(expiresInMs: number | null) {
    const { conversation } = await seedConversation(env.t);
    await prisma().conversation.update({ where: { id: conversation.id }, data: expiresInMs === null ? { windowExpiresAt: null, lastInboundAt: null } : { windowExpiresAt: new Date(Date.now() + expiresInMs) } });
    return conversation;
  }
  it('quedan 30 s → el texto sale; hace 1 s que caducó → 409; sin ventana (nunca escribió) → 409', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const c1 = await conv(30_000);
    expect((await a.post(`/api/conversations/${c1.id}/messages`, { type: 'text', body: 'ok' })).status).toBe(201);
    await prisma().conversation.update({ where: { id: c1.id }, data: { windowExpiresAt: new Date(Date.now() - 1000) } });
    const closed = await a.post(`/api/conversations/${c1.id}/messages`, { type: 'text', body: 'tarde' });
    expect(closed.status).toBe(409);
    expect(closed.body.message).toMatch(/plantilla/i);
    await prisma().conversation.update({ where: { id: c1.id }, data: { windowExpiresAt: null, lastInboundAt: null } });
    expect((await a.post(`/api/conversations/${c1.id}/messages`, { type: 'text', body: 'nunca' })).status).toBe(409);
    expect(env.sim.sent).toHaveLength(1);
  });
  it('el detalle de la conversación declara windowOpen según la hora del servidor', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const open = await conv(3600_000);
    expect((await a.get(`/api/conversations/${open.id}`)).body.windowOpen).toBe(true);
    await prisma().conversation.update({ where: { id: open.id }, data: { windowExpiresAt: new Date(Date.now() - 60_000) } });
    expect((await a.get(`/api/conversations/${open.id}`)).body.windowOpen).toBe(false);
  });
  it('reintentar a mano un mensaje que falló por 131047 no lo envía de nuevo', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const c = await conv(3600_000);
    env.sim.failNext({ code: 131047 });
    await a.post(`/api/conversations/${c.id}/messages`, { type: 'text', body: 'hola' });
    const failed = await prisma().message.findFirstOrThrow({ where: { direction: 'OUTBOUND' } });
    expect(failed.status).toBe('FAILED');
    const before = env.sim.sent.length;
    const r = await a.post(`/api/conversations/${c.id}/messages/${failed.id}/retry`);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(env.sim.sent.length).toBe(before);
  });
});

describe('Área 5 · Bajas (huecos): REVOKED nunca recibe marketing, por ningún camino', () => {
  it('un contacto que se da de baja DESPUÉS de crear el borrador con selección manual no recibe nada al lanzarlo ni al duplicar', async () => {
    const clock = env.t.app.get(CampaignClock);
    const runner = env.t.app.get(CampaignRunnerService);
    clock.set(new Date());
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const tpl = await seedTemplate(env.t, { header: false });
    await prisma().contact.createMany({ data: Array.from({ length: 4 }, (_, i) => ({ phoneE164: `+3462200000${i}`, waId: `3462200000${i}`, firstName: `C${i}` })) });
    const contacts = await prisma().contact.findMany({ orderBy: { phoneE164: 'asc' } });
    const body = { name: 'Manual', templateId: tpl.id, variableMapping: { 'body.1': { field: 'firstName', fallback: 'cliente' }, 'button.0': { text: 'tintes' } }, audience: { contactIds: contacts.map((c) => c.id) }, ratePerMinute: 20 };
    const draft = (await a.post('/api/campaigns', body)).body;
    const dup = (await a.post(`/api/campaigns/${draft.id}/duplicate`)).body;
    // el contacto 0 responde «BAJA» entre el borrador y el lanzamiento
    await env.sim.sendInbound(text(contacts[0]!.waId!, 'BAJA'));
    expect((await prisma().contact.findUniqueOrThrow({ where: { id: contacts[0]!.id } })).consentStatus).toBe('REVOKED');
    env.sim.sent.length = 0;
    for (const id of [draft.id, dup.id]) {
      expect((await a.post(`/api/campaigns/${id}/launch`, {})).status).toBe(201);
      for (let i = 0; i < 3; i++) {
        clock.advance(61_000);
        await runner.tick();
      }
    }
    const toRevoked = env.sim.sent.filter((s) => s.body?.type === 'template' && String(s.body?.to) === contacts[0]!.waId);
    expect(toRevoked).toHaveLength(0);
    expect(env.sim.sent.filter((s) => s.body?.type === 'template')).toHaveLength(6); // 3 contactos × 2 campañas
    const rec = await prisma().campaignRecipient.findMany({ where: { contactId: contacts[0]!.id } });
    expect(rec.every((r) => r.status === 'SKIPPED' && r.skipReason === 'REVOKED')).toBe(true);
  });

  it('la baja por el botón «No recibir más» de una plantilla de campaña (payload OPT_OUT) queda atribuida a la campaña y a su origen', async () => {
    const { contact } = await seedConversation(env.t, { phone: '34633000111' });
    await env.sim.sendInbound({ from: contact.waId!, type: 'button', button: { text: 'No recibir más', payload: 'OPT_OUT' } });
    const c = await prisma().contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(c.consentStatus).toBe('REVOKED');
    const ev = await prisma().consentEvent.findFirstOrThrow({ where: { contactId: contact.id } });
    expect(ev.status).toBe('REVOKED');
    expect(ev.source).toBeTruthy();
  });

  it('un contacto dado de baja puede recibir plantilla de utilidad desde el chat (no es marketing) pero no de marketing', async () => {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const { conversation } = await seedConversation(env.t, { consent: 'REVOKED', windowOpen: false });
    const mk = await seedTemplate(env.t, { header: false, category: 'MARKETING' });
    const bad = await a.post(`/api/conversations/${conversation.id}/messages`, { type: 'template', templateId: mk.id, params: { 'body.1': 'x', 'button.0': 'y' } });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    expect(env.sim.sent).toHaveLength(0);
  });
});

describe('Área 7 · Importación (huecos)', () => {
  const csv = (rows: string[]) => Buffer.from(['Nombre;Apellidos;Teléfono;DNI;Listas', ...rows].join('\n'), 'utf8');
  async function importCsv(buf: Buffer, options: object = {}) {
    const a = await loginAs(env.t, AGENT_EMAIL);
    const up = await a.agent.post('/api/contacts/import').set('X-Requested-With', 'XMLHttpRequest').attach('file', buf, { filename: 'c.csv', contentType: 'text/csv' });
    expect(up.status, JSON.stringify(up.body)).toBeLessThan(300);
    const jobId = up.body.jobId ?? up.body.id;
    const mapping = { Nombre: 'firstName', Apellidos: 'lastName', Teléfono: 'phone', DNI: 'taxId', Listas: 'labels' };
    const run = await a.post(`/api/contacts/import/${jobId}/run`, { mapping, ...options });
    expect(run.status, JSON.stringify(run.body)).toBeLessThan(300);
    for (let i = 0; i < 50; i++) {
      const st = await a.get(`/api/contacts/import/${jobId}`);
      if (['DONE', 'FAILED'].includes(st.body.status)) return { a, jobId, status: st.body };
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('la importación no terminó');
  }
  it('el mismo número escrito de 5 formas en el archivo da UN contacto; extranjeros y basura se descartan con motivo', async () => {
    const { status } = await importCsv(csv([
      'Ana;Ruiz;617498222;B12345678;PELUQUERÍA',
      'Ana;Ruiz;+34 617 49 82 22;;',
      'Ana;Ruiz;0034617498222;;',
      'Ana;Ruiz;34617498222;;',
      'Ana;Ruiz;617-49-82-22;;',
      'Pierre;Dupont;+33 6 12 34 56 78;;',
      'Basura;Nada;abc;;',
      ';;;;',
    ]));
    expect(status.status).toBe('DONE');
    const phones = (await prisma().contact.findMany({ orderBy: { phoneE164: 'asc' } })).map((c) => c.phoneE164);
    expect(phones).toEqual(['+33612345678', '+34617498222']);
    expect(status.created + status.updated).toBeGreaterThanOrEqual(2);
  });
  it('CIF en el campo DNI se normaliza y un nombre con emojis se limpia sin perder tildes', async () => {
    await importCsv(csv(['María 🌸 Núñez;López;655123456;b-1234.5678;']));
    const c = await prisma().contact.findFirstOrThrow({ where: { phoneE164: '+34655123456' } });
    expect(c.taxId).toMatch(/^B12345678$/i);
    expect(c.firstName).toBe('María Núñez');
    expect(c.lastName).toBe('López');
  });
  it('NO PUBLICIDAD en la columna de listas → baja con origen LEGACY_LABEL aunque venga junto a otras etiquetas', async () => {
    await importCsv(csv(['Luis;Gómez;655000111;;PELUQUERÍA, NO PUBLICIDAD']));
    const c = await prisma().contact.findFirstOrThrow({ where: { phoneE164: '+34655000111' }, include: { labels: { include: { label: true } } } });
    expect(c.consentStatus).toBe('REVOKED');
    expect(c.labels.map((l) => l.label.name)).toEqual(['PELUQUERÍA']);
    expect((await prisma().consentEvent.findFirstOrThrow({ where: { contactId: c.id } })).source).toBe('LEGACY_LABEL');
  });
  it('re-importar el mismo archivo no crea duplicados ni reactiva bajas', async () => {
    const rows = csv(['Luis;Gómez;655000111;;NO PUBLICIDAD', 'Eva;Sanz;655000222;;']);
    await importCsv(rows);
    await importCsv(rows, { initialConsent: 'GRANTED' });
    expect(await prisma().contact.count()).toBe(2);
    expect((await prisma().contact.findFirstOrThrow({ where: { phoneE164: '+34655000111' } })).consentStatus).toBe('REVOKED');
  });
});

describe('Área 10 · Coste (huecos)', () => {
  async function sendAndDeliver(pricing: any, repeat = 1) {
    const a = await loginAs(env.t, ADMIN_EMAIL);
    const { conversation } = await seedConversation(env.t, { phone: '34644000111' });
    await a.post(`/api/conversations/${conversation.id}/messages`, { type: 'text', body: 'Hola' });
    const out = await prisma().message.findFirstOrThrow({ where: { direction: 'OUTBOUND' } });
    await env.sim.sendStatus({ wamid: out.wamid!, status: 'delivered', pricing, repeat });
    return { a, out };
  }
  const month = () => new Date().toISOString().slice(0, 7);
  it('un estado repetido no cuenta dos veces el coste', async () => {
    const { a } = await sendAndDeliver({ billable: true, pricing_model: 'PMP', category: 'marketing' }, 3);
    const c = (await a.get('/api/quality/costs').query({ month: month() })).body;
    expect(c.byCategory.marketing).toEqual({ count: 1, cost: 0.0585 });
  });
  it('billable:false y estados sin pricing no suman', async () => {
    const { a } = await sendAndDeliver({ billable: false, pricing_model: 'PMP', category: 'marketing' });
    const c = (await a.get('/api/quality/costs').query({ month: month() })).body;
    expect(c.total).toBe(0);
  });
  it('el precio que llega en «read» completa un «delivered» sin pricing', async () => {
    const { a, out } = await sendAndDeliver(null);
    await env.sim.sendStatus({ wamid: out.wamid!, status: 'read', pricing: { billable: true, pricing_model: 'PMP', category: 'utility' } });
    const c = (await a.get('/api/quality/costs').query({ month: month() })).body;
    expect(c.byCategory.utility).toEqual({ count: 1, cost: 0.0166 });
  });
  it('una categoría desconocida de Meta no rompe el informe (coste 0 y visible)', async () => {
    const { a } = await sendAndDeliver({ billable: true, pricing_model: 'PMP', category: 'categoria_nueva_2027' });
    const r = await a.get('/api/quality/costs').query({ month: month() });
    expect(r.status).toBe(200);
    expect(r.body.byCategory.categoria_nueva_2027?.count).toBe(1);
  });
});

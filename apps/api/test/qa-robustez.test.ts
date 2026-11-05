/**
 * QA · robustez: entradas hostiles o raras que un usuario (o Meta) puede mandar de verdad.
 * Criterio común: nunca un 500, y los errores salen en español. Los fallos van con `it.fails` y quedan en docs/trabajo/QA.md.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWaTestEnv, seedConversation, type WaTestEnv } from './meta-simulator/harness';
import { ADMIN_EMAIL, AGENT_EMAIL, loginAs } from './utils/app';

let env: WaTestEnv;
let a: Awaited<ReturnType<typeof loginAs>>;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
  a = await loginAs(env.t, ADMIN_EMAIL);
});
const prisma = () => env.t.prisma;

const WEIRD = ["'", '"', '%', '_', '\\', '& | ! ( ) :', "'; DROP TABLE \"Contact\"; --", '*:*', 'a b c d e f g h i j', '<script>alert(1)</script>', '😀', 'ñ', '   ', '+', '(', ')', ':*', '!', '@@', '-', '\\u0000', 'a'.repeat(5000)];

describe('Búsquedas con caracteres raros (conversaciones y contactos): nunca 500', () => {
  it.each(WEIRD.map((w) => [JSON.stringify(w).slice(0, 40), w] as const))('q = %s', async (_n, q) => {
    await seedConversation(env.t);
    await prisma().message.create({ data: { conversationId: (await prisma().conversation.findFirstOrThrow()).id, direction: 'INBOUND', kind: 'TEXT', body: "Hola 100% d'O'Brien & co", status: 'RECEIVED' } });
    for (const url of ['/api/conversations', '/api/contacts']) {
      const r = await a.get(url).query({ q });
      expect(r.status, `${url}?q=${JSON.stringify(q).slice(0, 60)} → ${JSON.stringify(r.body).slice(0, 200)}`).toBeLessThan(500);
    }
  });

  it('% y _ se buscan como texto, no como comodines', async () => {
    await prisma().contact.createMany({ data: [{ phoneE164: '+34600000001', firstName: 'Cien%' }, { phoneE164: '+34600000002', firstName: 'Ciento' }] });
    const r = await a.get('/api/contacts').query({ q: 'Cien%' });
    expect(r.status).toBe(200);
    const names = (r.body.items ?? r.body.data ?? []).map((c: any) => c.firstName);
    expect(names).toEqual(['Cien%']);
  });
});

describe('Búsquedas · fallos conocidos', () => {
  // FALLO F-4: el carácter NUL (\u0000) llega a Postgres y da 500
  it.fails('q con carácter NUL en /api/conversations → nunca 500', async () => {
    const r = await a.get('/api/conversations').query({ q: 'a\u0000b' });
    expect(r.status).toBeLessThan(500);
  });
});

describe('Identificadores y parámetros mal formados → 4xx, nunca 500', () => {
  it.each([
    ['GET', '/api/conversations/no-es-uuid'],
    ['GET', '/api/conversations/no-es-uuid/timeline'],
    ['GET', '/api/contacts/123'],
    ['GET', '/api/campaigns/x'],
    ['GET', '/api/templates/x'],
    ['GET', '/api/media/x/url'],
    ['GET', '/api/contacts/import/zzz'],
    ['GET', '/api/conversations?cursor=%%%'],
    ['GET', '/api/conversations?cursor=eyJ4IjoxfQ'],
    ['GET', '/api/conversations?view=inventada'],
    ['GET', '/api/conversations?tab=otra'],
    ['GET', '/api/conversations?labelId=no-uuid'],
    ['GET', '/api/conversations?limit=-5'],
    ['GET', '/api/conversations?limit=999999999'],
    ['GET', '/api/contacts?page=0'],
    ['GET', '/api/contacts?page=abc'],
    ['GET', '/api/contacts?pageSize=100000'],
    ['GET', '/api/quality/costs?month=hoy'],
    ['GET', '/api/library/files?folderId=x'],
  ])('%s %s', async (m, url) => {
    const r = await a.get(url);
    expect(r.status, `${url} → ${JSON.stringify(r.body).slice(0, 200)}`).toBeLessThan(500);
  });

  // FALLO F-5: un filtro con id de etiqueta que no es UUID llega a Prisma y da 500
  it.fails('GET /api/contacts?includeLabelIds=no-uuid → 4xx', async () => {
    expect((await a.get('/api/contacts?includeLabelIds=no-uuid')).status).toBeLessThan(500);
  });
  // FALLO F-6: fecha de filtro no válida en el registro de actividad → 500
  it.fails('GET /api/audit?from=ayer → 4xx', async () => {
    expect((await a.get('/api/audit?from=ayer')).status).toBeLessThan(500);
  });

  it('cuerpos con tipos equivocados no dan 500', async () => {
    const { conversation } = await seedConversation(env.t);
    const bodies: Array<[string, string, unknown]> = [
      ['post', `/api/conversations/${conversation.id}/messages`, { type: 'text', body: { a: 1 } }],
      ['post', `/api/conversations/${conversation.id}/messages`, { type: 'media', mediaFileIds: 'x' }],
      ['post', `/api/conversations/${conversation.id}/messages`, { type: 'template', templateId: 5 }],
      ['post', `/api/conversations/${conversation.id}/messages`, { type: 'nota-rara' }],
      ['post', `/api/conversations/${conversation.id}/snooze`, { preset: 'custom', until: 'mañana' }],
      ['post', `/api/conversations/${conversation.id}/snooze`, { preset: 'custom', until: '2001-01-01T00:00:00Z' }],
      ['post', `/api/conversations/${conversation.id}/assign`, { assigneeId: 'no-uuid' }],
      ['post', `/api/conversations/${conversation.id}/labels`, { add: 'x' }],
      ['post', '/api/contacts/bulk', { contactIds: [], action: 'addLabel' }],
      ['post', '/api/campaigns/audience-count', { audience: { includeLabelIds: ['no-uuid'] } }],
      ['post', '/api/campaigns/audience-count', null],
      ['post', '/api/contacts', { phone: 'a'.repeat(10000) }],
      ['post', '/api/contacts', { phone: '+34600111222', email: 'no-es-correo' }],
      ['post', '/api/contacts', { phone: '+34600111222', firstName: 'x'.repeat(100000) }],
    ];
    const bad: string[] = [];
    for (const [m, url, body] of bodies) {
      const r = await (a as any)[m](url, body);
      if (r.status >= 500) bad.push(`${m} ${url} ${JSON.stringify(body).slice(0, 60)} → ${r.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('JSON roto en el cuerpo → 400 en español', async () => {
    const r = await a.agent.post('/api/contacts').set('X-Requested-With', 'XMLHttpRequest').set('Content-Type', 'application/json').send('{"phone": ');
    expect(r.status).toBe(400);
  });

  // FALLO F-7: el límite del cuerpo JSON responde 500 en lugar de 413
  it.fails('un cuerpo JSON enorme (> límite) → 413, no 500', async () => {
    const r = await a.agent.post('/api/contacts').set('X-Requested-With', 'XMLHttpRequest').send({ phone: '+34600111222', notes: 'x'.repeat(12 * 1024 * 1024) });
    expect([400, 413]).toContain(r.status);
  });
});

describe('Texto con caracteres que Postgres no admite', () => {
  // FALLO F-4
  it.fails('una nota interna con carácter NUL (\\u0000) no da 500', async () => {
    const { conversation } = await seedConversation(env.t);
    const r = await a.post(`/api/conversations/${conversation.id}/messages`, { type: 'note', body: 'hola\u0000mundo' });
    expect(r.status).toBeLessThan(500);
  });
  // FALLO F-4 (webhook: Meta reintentaría sin fin)
  it.fails('un entrante de Meta con \\u0000 en el texto no se pierde: el webhook responde 200 y el mensaje queda guardado', async () => {
    expect(await env.sim.sendInbound({ from: '34600111222', type: 'text', text: { body: 'hola\u0000mundo' } })).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    const n = await prisma().message.count({ where: { direction: 'INBOUND' } });
    expect(n, `errores en línea: ${JSON.stringify(env.t.jobs.inlineErrors.map((e) => String(e.error ?? e)).slice(0, 2))}`).toBe(1);
  });
  it('un nombre de perfil de WhatsApp con emojis y escrituras no latinas se guarda tal cual', async () => {
    await env.sim.sendInbound({ from: '34600111222', type: 'text', text: { body: 'hi' }, name: '🧔 محمد الأحمد 田中' });
    expect((await prisma().contact.findFirstOrThrow()).profileName).toBe('🧔 محمد الأحمد 田中');
  });
  it('un mensaje de texto de 4.096 caracteres (máximo de WhatsApp) entra y sale; 4.097 se rechaza con mensaje claro', async () => {
    const { conversation } = await seedConversation(env.t);
    const ok = await a.post(`/api/conversations/${conversation.id}/messages`, { type: 'text', body: 'a'.repeat(4096) });
    expect(ok.status).toBe(201);
    const long = await a.post(`/api/conversations/${conversation.id}/messages`, { type: 'text', body: 'a'.repeat(4097) });
    expect(long.status).toBe(400);
  });
});

describe('Ajustes: valores que romperían el funcionamiento si se aceptaran', () => {
  const hours = (over: object = {}) => ({ timezone: 'Europe/Madrid', days: { mon: [{ from: '09:00', to: '14:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [], ...over } });
  async function currentHours() {
    return (await a.get('/api/settings')).body.business_hours ?? (await a.get('/api/settings')).body.businessHours;
  }
  // FALLO F-8
  it.fails('una zona horaria que no existe se rechaza (si no, cada mensaje entrante fallaría al comprobar el horario)', async () => {
    const cur = await currentHours();
    const r = await a.put('/api/settings/business_hours', { ...cur, timezone: 'Marte/Olimpo' });
    expect(r.status).toBe(400);
  });
  // FALLO F-9
  it.fails('un tramo con «hasta» anterior a «desde» o tramos solapados se rechazan', async () => {
    const cur = await currentHours();
    const bad1 = await a.put('/api/settings/business_hours', { ...cur, days: { ...cur.days, mon: [{ from: '14:00', to: '09:00' }] } });
    const bad2 = await a.put('/api/settings/business_hours', { ...cur, days: { ...cur.days, mon: [{ from: '09:00', to: '14:00' }, { from: '13:00', to: '18:00' }] } });
    expect([bad1.status, bad2.status]).toEqual([400, 400]);
  });
  it('tarifas negativas o NaN, ritmo 0 y límite diario 0 se rechazan', async () => {
    const cur = (await a.get('/api/settings')).body;
    expect((await a.put('/api/settings/rates', { ...cur.rates, marketing: -1 })).status).toBe(400);
    expect((await a.put('/api/settings/campaign_defaults', { ...cur.campaign_defaults, ratePerMinute: 0 })).status).toBe(400);
    expect((await a.put('/api/settings/campaign_defaults', { ...cur.campaign_defaults, dailyLimit: 0 })).status).toBe(400);
  });
  it('un botón de respuesta automática de más de 20 caracteres se rechaza con el motivo en español', async () => {
    const cur = (await a.get('/api/settings')).body.out_of_hours;
    const r = await a.put('/api/settings/out_of_hours', { ...cur, buttons: [{ id: 'X', title: 'Quiero hacer un pedido ya' }] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/20 caracteres/);
  });
  it('clave de ajuste desconocida → 4xx', async () => {
    expect((await a.put('/api/settings/no_existe', { x: 1 })).status).toBeLessThan(500);
    expect((await a.put('/api/settings/no_existe', { x: 1 })).status).toBeGreaterThanOrEqual(400);
  });
  it('hours() de ayuda coherente', () => expect(hours().days.mon).toHaveLength(1));
});

describe('Usuarios y sesiones', () => {
  it('el correo del login no distingue mayúsculas', async () => {
    const r = await env.t.http.post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: ADMIN_EMAIL.toUpperCase(), password: 'contraseña-de-prueba-1' });
    expect(r.status).toBe(200);
  });
  it('invitar a un correo ya registrado → 409 en español', async () => {
    const r = await a.post('/api/users', { email: AGENT_EMAIL, name: 'Repetida', role: 'AGENT' });
    expect(r.status).toBe(409);
  });
  it('una sesión revocada por «cerrar sesión» no vuelve a valer con la misma cookie', async () => {
    const s = await loginAs(env.t, AGENT_EMAIL);
    const cookie = s.agent.jar?.getCookies?.({ domain: '127.0.0.1', path: '/', secure: false, script: false }) ?? [];
    await s.post('/api/auth/logout');
    expect((await s.get('/api/conversations')).status).toBe(401);
    expect(cookie).toBeDefined();
  });
  it('un enlace de nueva contraseña caducado (> 24 h) no sirve', async () => {
    const agent = await prisma().user.findUniqueOrThrow({ where: { email: AGENT_EMAIL } });
    const link = await a.post(`/api/users/${agent.id}/reset-link`);
    const token = link.body.url.split('/').pop();
    await prisma().$executeRawUnsafe(`UPDATE "PasswordResetToken" SET "expiresAt" = now() - interval '1 hour'`);
    const info = await env.t.http.get(`/api/auth/token/${token}`);
    expect(info.body.valid ?? false).toBe(false);
    const set = await env.t.http.post('/api/auth/set-password').set('X-Requested-With', 'XMLHttpRequest').send({ token, password: 'una-clave-larga-nueva' });
    expect(set.status).toBeGreaterThanOrEqual(400);
  });
});

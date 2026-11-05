/**
 * QA · Área 8 de docs/08: permisos. Recorre TODO `ENDPOINTS` de packages/shared:
 *  - ninguno devuelve 404 de ruta (todo lo declarado existe) ni 5xx con una petición vacía;
 *  - sin sesión: 401 (salvo los `public` y `token`);
 *  - agente: cada endpoint `admin` responde exactamente 403 (endurece la prueba de auth.test.ts, que aceptaba 404);
 *  - administradora: no recibe 401/403 en ninguno;
 *  - con sesión pero sin X-Requested-With, toda petición que cambia datos responde 403 (CSRF).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENDPOINTS, type EndpointDef } from '@gelado/shared';
import { createTestApp, loginAs, ADMIN_EMAIL, AGENT_EMAIL, type TestApp } from './utils/app';

let t: TestApp;
let admin: Awaited<ReturnType<typeof loginAs>>;
let agent: Awaited<ReturnType<typeof loginAs>>;
beforeAll(async () => {
  // Meta inalcanzable a propósito (puerto cerrado): ninguna prueba debe llegar a la Graph API real
  t = await createTestApp({ META_GRAPH_BASE_URL: 'http://127.0.0.1:9' });
  await t.reset();
  admin = await loginAs(t, ADMIN_EMAIL);
  agent = await loginAs(t, AGENT_EMAIL);
});
afterAll(async () => t.close());

const ZERO = '00000000-0000-4000-8000-000000000000';
const url = (path: string) =>
  path
    .replace('/api/settings/:key', '/api/settings/rates')
    .replace(':token', 'token-inexistente')
    .replace(/:[a-zA-Z]+/g, ZERO);
/** Un 404 «de ruta» lo genera Nest con «Cannot GET /…»; un 404 de recurso tiene mensaje en español. */
const isRoute404 = (r: { status: number; body: any }) => r.status === 404 && /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(String(r.body?.message ?? ''));
const call = (who: typeof admin, e: EndpointDef) => {
  const fn = { GET: who.get, POST: who.post, PATCH: who.patch, PUT: who.put, DELETE: who.del }[e.method];
  return fn(url(e.path), e.method === 'GET' || e.method === 'DELETE' ? undefined : {});
};
const row = (e: EndpointDef) => [e.method, e.path] as const;
const find = (m: string, p: string) => ENDPOINTS.find((e) => e.method === m && e.path === p)!;

describe('QA · Área 8 · el contrato ENDPOINTS está completo', () => {
  it('la lista no tiene duplicados y cubre los 4 roles', () => {
    const keys = ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(ENDPOINTS.map((e) => e.role))).toEqual(new Set(['public', 'any', 'admin', 'token']));
    expect(ENDPOINTS.filter((e) => e.role === 'admin').length).toBeGreaterThanOrEqual(30);
  });

  it.each(ENDPOINTS.map(row))('%s %s existe (ni 404 de ruta ni 5xx con petición vacía de la administradora)', async (method, path) => {
    const e = find(method, path);
    if (e.role === 'public' || e.role === 'token') {
      // Sin sesión: la ruta existe. (login/set-password con cuerpo vacío → 400; webhook POST sin firma → 401)
      const fn = { GET: t.http.get, POST: t.http.post, PATCH: t.http.patch, PUT: t.http.put, DELETE: t.http.delete }[method].bind(t.http);
      const r = await (method === 'GET' ? fn(url(path)) : fn(url(path)).set('X-Requested-With', 'XMLHttpRequest').send({}));
      expect(isRoute404(r), `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`).toBe(false);
      expect(r.status).toBeLessThan(500);
      return;
    }
    // logout revoca la sesión: se prueba con una sesión desechable para no tirar la de la administradora
    const r = await call(path === '/api/auth/logout' ? await loginAs(t, ADMIN_EMAIL) : admin, e);
    expect(isRoute404(r), `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`).toBe(false);
    // 502 = Meta inalcanzable (esperado en esta prueba); un 500 sería un fallo no controlado
    expect([500, 503], `${method} ${path} → ${JSON.stringify(r.body)}`).not.toContain(r.status);
    expect([401, 403], `la administradora no debe recibir ${r.status} en ${method} ${path}`).not.toContain(r.status);
  });
});

describe('QA · Área 8 · sin sesión → 401', () => {
  const protectedEndpoints = ENDPOINTS.filter((e) => e.role === 'any' || e.role === 'admin');
  it.each(protectedEndpoints.map(row))('%s %s → 401 sin sesión', async (method, path) => {
    const e = find(method, path);
    const fn = { GET: t.http.get, POST: t.http.post, PATCH: t.http.patch, PUT: t.http.put, DELETE: t.http.delete }[method].bind(t.http);
    const req = fn(url(path));
    const r = await (method === 'GET' ? req : req.set('X-Requested-With', 'XMLHttpRequest').send({}));
    expect(r.status, `${e.method} ${e.path}`).toBe(401);
  });

  it('/api/status (token): sin token 401; con el STATUS_TOKEN 200', async () => {
    expect((await t.http.get('/api/status')).status).toBe(401);
    expect((await t.http.get('/api/status').set('Authorization', 'Bearer test-status-token')).status).toBe(200);
  });

  it('una cookie de sesión inventada no sirve', async () => {
    const r = await t.http.get('/api/conversations').set('Cookie', 'gelado_sid=abcdef0123456789');
    expect(r.status).toBe(401);
  });
});

describe('QA · Área 8 · cada endpoint de administradora rechaza a un agente con 403 exacto', () => {
  const adminEndpoints = ENDPOINTS.filter((e) => e.role === 'admin');
  it.each(adminEndpoints.map(row))('%s %s → 403 para agente', async (method, path) => {
    const r = await call(agent, find(method, path));
    expect(r.status, `${method} ${path} → ${JSON.stringify(r.body)}`).toBe(403);
  });
});

describe('QA · Área 8 · los endpoints «any» sí los abre un agente', () => {
  const anyEndpoints = ENDPOINTS.filter((e) => e.role === 'any' && e.path !== '/api/auth/logout');
  it.each(anyEndpoints.map(row))('%s %s → ni 401 ni 403 para agente', async (method, path) => {
    const r = await call(agent, find(method, path));
    expect([401, 403], `${method} ${path} → ${JSON.stringify(r.body)}`).not.toContain(r.status);
    expect(r.status).toBeLessThan(500);
  });
});

describe('QA · Área 8 · CSRF (X-Requested-With) en toda petición que cambia datos', () => {
  const mutating = ENDPOINTS.filter((e) => e.method !== 'GET' && (e.role === 'any' || e.role === 'admin'));
  it.each(mutating.map(row))('%s %s sin X-Requested-With → 403 aunque haya sesión', async (method, path) => {
    const fn = { POST: admin.agent.post, PATCH: admin.agent.patch, PUT: admin.agent.put, DELETE: admin.agent.delete }[method as 'POST'].bind(admin.agent);
    const r = await fn(url(path)).send({});
    expect(r.status, `${method} ${path}`).toBe(403);
  });
});

describe('QA · Área 8 · cambios de rol y desactivación se aplican al instante', () => {
  it('un agente promovido a administradora puede entrar en Ajustes; degradado, deja de poder', async () => {
    const lolo = await loginAs(t, 'geladoexclusivas@gmail.com');
    expect((await lolo.get('/api/audit')).status).toBe(403);
    expect((await admin.patch(`/api/users/${lolo.user.id}`, { role: 'ADMIN' })).status).toBe(200);
    expect((await lolo.get('/api/audit')).status).toBe(200);
    expect((await admin.patch(`/api/users/${lolo.user.id}`, { role: 'AGENT' })).status).toBe(200);
    expect((await lolo.get('/api/audit')).status).toBe(403);
  });

  it('la administradora no puede dejarse sin rol de administradora ni desactivarse (no queda la cuenta bloqueada)', async () => {
    const r = await admin.patch(`/api/users/${admin.user.id}`, { active: false });
    // Si lo permite, el sistema se queda sin administradora: es un fallo de integridad (ver QA.md)
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe('QA · Área 8 · superficie fuera de /api', () => {
  it('/webhooks/whatsapp POST exige firma aunque haya sesión; GET exige verify token', async () => {
    expect((await admin.agent.post('/webhooks/whatsapp').set('X-Requested-With', 'XMLHttpRequest').send({ object: 'x' })).status).toBe(401);
    expect((await request(t.app.getHttpServer()).get('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=1')).status).toBe(403);
  });
  it('rutas desconocidas de /api dan 404 en JSON (no HTML ni 500)', async () => {
    const r = await admin.get('/api/no-existe');
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(/json/);
  });
});

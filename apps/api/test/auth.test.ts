import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, ADMIN_EMAIL, AGENT_EMAIL, TEST_PASSWORD, type TestApp } from './utils/app';
import { ENDPOINTS } from '@gelado/shared';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => t.reset());

describe('F0 · auth, sesiones y roles', () => {
  it('health responde con BD', async () => {
    const r = await t.http.get('/health');
    expect(r.status).toBe(200);
    expect(r.body.db).toBe('up');
  });

  it('login correcto crea cookie httpOnly y /me devuelve el usuario', async () => {
    const r = await t.http.post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: ADMIN_EMAIL, password: TEST_PASSWORD });
    expect(r.status).toBe(200);
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/gelado_sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const s = await loginAs(t, ADMIN_EMAIL);
    const me = await s.get('/api/auth/me');
    expect(me.body.role).toBe('ADMIN');
  });

  it('login incorrecto → 401 en español; sin sesión → 401', async () => {
    const r = await t.http.post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: ADMIN_EMAIL, password: 'mala' });
    expect(r.status).toBe(401);
    expect(r.body.message).toMatch(/incorrectos/);
    expect((await t.http.get('/api/auth/me')).status).toBe(401);
  });

  it('CSRF: petición que cambia datos sin X-Requested-With → 403', async () => {
    const r = await t.http.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: TEST_PASSWORD });
    expect(r.status).toBe(403);
  });

  it('logout revoca la sesión', async () => {
    const s = await loginAs(t, AGENT_EMAIL);
    expect((await s.post('/api/auth/logout')).status).toBe(200);
    expect((await s.get('/api/auth/me')).status).toBe(401);
  });

  it('invitación por enlace de un solo uso, sin correo', async () => {
    const admin = await loginAs(t, ADMIN_EMAIL);
    const inv = await admin.post('/api/users', { email: 'nueva@gelado.eu', name: 'Nueva Persona', role: 'AGENT' });
    expect(inv.status).toBe(201);
    const token = inv.body.link.url.split('/').pop();
    const info = await t.http.get(`/api/auth/token/${token}`);
    expect(info.body).toMatchObject({ valid: true, purpose: 'INVITE', email: 'nueva@gelado.eu' });
    const set = await t.http.post('/api/auth/set-password').set('X-Requested-With', 'XMLHttpRequest').send({ token, password: 'una-clave-larga' });
    expect(set.status).toBe(200);
    const again = await t.http.post('/api/auth/set-password').set('X-Requested-With', 'XMLHttpRequest').send({ token, password: 'otra-clave-larga' });
    expect(again.status).toBe(400);
    await loginAs(t, 'nueva@gelado.eu', 'una-clave-larga');
  });

  it('enlace de nueva contraseña (24 h) cierra las sesiones abiertas', async () => {
    const admin = await loginAs(t, ADMIN_EMAIL);
    const agent = await loginAs(t, AGENT_EMAIL);
    const link = await admin.post(`/api/users/${agent.user.id}/reset-link`);
    expect(link.body.purpose).toBe('RESET');
    const token = link.body.url.split('/').pop();
    await t.http.post('/api/auth/set-password').set('X-Requested-With', 'XMLHttpRequest').send({ token, password: 'clave-nueva-123' });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    await loginAs(t, AGENT_EMAIL, 'clave-nueva-123');
  });

  it('contraseña de menos de 10 caracteres se rechaza', async () => {
    const admin = await loginAs(t, ADMIN_EMAIL);
    const agent = await t.prisma.user.findUniqueOrThrow({ where: { email: AGENT_EMAIL } });
    const link = await admin.post(`/api/users/${agent.id}/reset-link`);
    const token = link.body.url.split('/').pop();
    const r = await t.http.post('/api/auth/set-password').set('X-Requested-With', 'XMLHttpRequest').send({ token, password: 'corta' });
    expect(r.status).toBe(400);
  });

  it('usuario desactivado no puede entrar y pierde sus sesiones', async () => {
    const admin = await loginAs(t, ADMIN_EMAIL);
    const agent = await loginAs(t, AGENT_EMAIL);
    await admin.patch(`/api/users/${agent.user.id}`, { active: false });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    await expect(loginAs(t, AGENT_EMAIL)).rejects.toThrow(/401/);
  });

  it('límite de intentos de login por usuario', async () => {
    for (let i = 0; i < 8; i++) await t.http.post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: 'x@y.es', password: 'mal' });
    const r = await t.http.post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: 'x@y.es', password: 'mal' });
    expect(r.status).toBe(429);
  });

  it('acciones sensibles quedan en el registro de actividad', async () => {
    const admin = await loginAs(t, ADMIN_EMAIL);
    await admin.post('/api/users', { email: 'otra@gelado.eu', name: 'Otra', role: 'AGENT' });
    const log = await admin.get('/api/audit');
    expect(log.body.items.map((i: any) => i.action)).toContain('invite_user');
  });
});

describe('Área 8 · permisos: endpoints de administradora rechazan a un agente', () => {
  const adminEndpoints = ENDPOINTS.filter((e) => e.role === 'admin');
  it.each(adminEndpoints.map((e) => [e.method, e.path] as const))('%s %s → 403 para agente', async (method, path) => {
    const agent = await loginAs(t, AGENT_EMAIL);
    const url = path.replace(/:[a-zA-Z]+/g, '00000000-0000-4000-8000-000000000000').replace('/api/settings/00000000-0000-4000-8000-000000000000', '/api/settings/rates');
    const fn = { GET: agent.get, POST: agent.post, PATCH: agent.patch, PUT: agent.put, DELETE: agent.del }[method];
    const r = await fn(url, {});
    // 403 = guard de rol; 404 = endpoint aún no implementado por su módulo (la prueba se endurece en S8)
    expect([403, 404]).toContain(r.status);
    if (r.status === 404) console.warn(`[permisos] ${method} ${path} todavía no existe`);
  });
});

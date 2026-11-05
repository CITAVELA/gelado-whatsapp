// Regresiones de la revisión de seguridad (S10) en la parte del orquestador: M1, M2, B2, B3, B12.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket } from 'socket.io-client';
import { createTestApp, loginAs, ADMIN_EMAIL, AGENT_EMAIL, TEST_PASSWORD, type TestApp } from './utils/app';
import { loadConfig } from '../src/common/config';
import { RealtimeService } from '../src/modules/realtime/realtime.gateway';

let t: TestApp;
let base: string;
beforeAll(async () => {
  t = await createTestApp();
  await t.app.listen(0);
  base = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => t.close());
beforeEach(async () => t.reset());

async function cookieFor(email: string) {
  const r = await t.http.post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ email, password: TEST_PASSWORD });
  return String(r.headers['set-cookie']).split(';')[0]!;
}

function connect(cookie: string, origin?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(base, { path: '/ws', transports: ['websocket'], extraHeaders: { cookie, ...(origin ? { origin } : {}) }, reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
    setTimeout(() => reject(new Error('timeout')), 4000);
  });
}

describe('M1 · CSRF sin depender del prefijo ni de mayúsculas', () => {
  it('POST /API/contacts sin cabecera → 403', async () => {
    const cookie = await cookieFor(AGENT_EMAIL);
    const r = await t.http.post('/API/contacts').set('Cookie', cookie).send({ phone: '+34600123123' });
    expect(r.status).toBe(403);
    const r2 = await t.http.post('/Api/auth/logout').set('Cookie', cookie);
    expect(r2.status).toBe(403);
  });
  it('el webhook firmado (SkipCsrf) no exige la cabecera', async () => {
    const r = await t.http.post('/webhooks/whatsapp').send({});
    expect(r.status).toBe(401); // firma, no CSRF
  });
});

describe('M2 · tiempo real: origen y revocación', () => {
  it('rechaza el handshake desde otro origen', async () => {
    const cookie = await cookieFor(AGENT_EMAIL);
    await expect(connect(cookie, 'https://evil.example')).rejects.toBeTruthy();
  });
  it('al desactivar al usuario se corta su socket y deja de recibir eventos', async () => {
    const cookie = await cookieFor(AGENT_EMAIL);
    const sock = await connect(cookie, 'http://localhost:5173');
    const got: string[] = [];
    sock.on('alert' as any, () => got.push('alert'));
    const disconnected = new Promise<void>((r) => sock.on('disconnect', () => r()));
    const admin = await loginAs(t, ADMIN_EMAIL);
    const agent = await t.prisma.user.findUniqueOrThrow({ where: { email: AGENT_EMAIL } });
    await admin.patch(`/api/users/${agent.id}`, { active: false });
    await disconnected;
    t.app.get(RealtimeService).emit('alert', { alerts: [] });
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toEqual([]);
  });
  it('al cerrar sesión se corta el socket de esa sesión', async () => {
    const cookie = await cookieFor(AGENT_EMAIL);
    const sock = await connect(cookie);
    const disconnected = new Promise<void>((r) => sock.on('disconnect', () => r()));
    await t.http.post('/api/auth/logout').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest');
    await disconnected;
  });
});

describe('B2 · la cookie se renueva al deslizar la caducidad', () => {
  it('con sesión vista hace más de 1 h, la respuesta reemite la cookie', async () => {
    const cookie = await cookieFor(AGENT_EMAIL);
    await t.prisma.session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 2 * 3600e3) } });
    const r = await t.http.get('/api/auth/me').set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(String(r.headers['set-cookie'])).toMatch(/gelado_sid=.*Max-Age=2592000/i);
  });
});

describe('B3 · RLS activado en todas las tablas del esquema app', () => {
  it('ninguna tabla de app sin rowsecurity', async () => {
    const rows = await t.prisma.$queryRaw<{ tablename: string; rowsecurity: boolean }[]>`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'app' AND tablename <> '_prisma_migrations'`;
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((r) => !r.rowsecurity).map((r) => r.tablename)).toEqual([]);
  });
});

describe('B12/B4 · comprobaciones de arranque en producción', () => {
  const good = {
    NODE_ENV: 'production', DATABASE_URL: 'postgresql://x', APP_URL: 'https://gelado-whatsapp.onrender.com', SESSION_SECRET: 'a'.repeat(64), STATUS_TOKEN: 'b'.repeat(40),
    META_APP_ID: '1', META_APP_SECRET: 's', WA_SYSTEM_USER_TOKEN: 't', WA_VERIFY_TOKEN: 'v', META_GRAPH_BASE_URL: 'https://graph.facebook.com',
    STORAGE_DRIVER: 'supabase', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k',
  } as NodeJS.ProcessEnv;
  it('la configuración correcta arranca', () => expect(() => loadConfig(good)).not.toThrow());
  it.each([
    ['META_GRAPH_BASE_URL', 'http://127.0.0.1:4010'],
    ['STORAGE_DRIVER', 'local'],
    ['APP_URL', 'http://localhost:3000'],
    ['STATUS_TOKEN', 'corto'],
    ['SESSION_SECRET', 'dev-session-secret-local-only-0123456789'],
  ])('rechaza %s=%s', (k, v) => expect(() => loadConfig({ ...good, [k]: v })).toThrow(/producción/));
});

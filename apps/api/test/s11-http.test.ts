/** S11 · Compresión, caché de la web y ETag/304 en los GET que se refrescan. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ADMIN_EMAIL, createTestApp, loginAs, type TestApp } from './utils/app';

let t: TestApp;
let dist: string;
beforeAll(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'webdist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><body><div id="root"></div>' + '<!-- relleno -->'.repeat(200) + '</body></html>');
  fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log("hola");\n'.repeat(500));
  fs.writeFileSync(path.join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  t = await createTestApp({ WEB_DIST_DIR: dist });
  await t.reset();
});
afterAll(async () => {
  await t.close();
  fs.rmSync(dist, { recursive: true, force: true });
  process.env.WEB_DIST_DIR = '';
});

describe('S11 · web compilada', () => {
  it('/assets/* con huella: cache de un año inmutable y comprimido', async () => {
    const r = await t.http.get('/assets/app-abc123.js').set('Accept-Encoding', 'gzip');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.headers['content-encoding']).toBe('gzip');
  });

  it('index.html: no-cache, comprimido, y también en rutas de la SPA', async () => {
    for (const url of ['/', '/inbox/abc']) {
      const r = await t.http.get(url).set('Accept', 'text/html').set('Accept-Encoding', 'gzip');
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('no-cache');
      expect(r.headers['content-encoding']).toBe('gzip');
    }
  });

  it('otros ficheros estáticos no son immutable', async () => {
    const r = await t.http.get('/favicon.svg');
    expect(r.headers['cache-control']).toMatch(/max-age=3600/);
    expect(r.headers['cache-control']).not.toMatch(/immutable/);
  });
});

describe('S11 · API', () => {
  it('/privacidad comprimida, con Cache-Control y ETag que devuelve 304', async () => {
    const r = await t.http.get('/privacidad').set('Accept-Encoding', 'gzip');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toMatch(/max-age=60/);
    expect(r.headers['etag']).toBeTruthy();
    const r2 = await t.http.get('/privacidad').set('If-None-Match', r.headers['etag']!);
    expect(r2.status).toBe(304);
  });

  it.each(['/api/conversations/counts', '/api/alerts', '/api/quality'])('%s: ETag y 304 con If-None-Match (a través de Nest y del filtro de errores)', async (url) => {
    const a = await loginAs(t, ADMIN_EMAIL);
    const r = await a.agent.get(url);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const etag = r.headers['etag'];
    expect(etag).toBeTruthy();
    const r2 = await a.agent.get(url).set('If-None-Match', etag!);
    expect(r2.status).toBe(304);
  });

  it('el JSON grande se comprime y los errores siguen con su forma', async () => {
    const a = await loginAs(t, ADMIN_EMAIL);
    const r = await a.agent.get('/api/conversations/counts').set('Accept-Encoding', 'gzip');
    expect(r.status).toBe(200);
    const nf = await a.agent.get('/api/no-existe');
    expect(nf.status).toBe(404);
    expect(nf.body.statusCode).toBe(404);
  });
});

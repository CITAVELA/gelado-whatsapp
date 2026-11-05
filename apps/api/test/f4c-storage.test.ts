/**
 * F4c · #18 firma de URLs de Storage en lote con caché · B9 auditoría de la biblioteca · B8 en la descarga local.
 */
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWaTestEnv, seedConversation, PNG_1X1, type WaTestEnv } from './meta-simulator/harness';
import { ADMIN_EMAIL, loginAs } from './utils/app';
import { StorageService, SupabaseStorageDriver, SIGNED_URL_CACHE_MS } from '../src/modules/storage/storage.service';
import { MediaService } from '../src/modules/media/media.service';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const paths = (n: number) => Array.from({ length: n }, (_, i) => `2026/11/obj-${i}.png`);

describe('F4c #18 · StorageService: firma en lote y caché', () => {
  function supabaseService() {
    const svc = new StorageService();
    (svc as any).driver = new SupabaseStorageDriver('https://x.supabase.test', 'service-key', 'media');
    const calls: Array<{ url: string; body: any }> = [];
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      const body = init?.body ? JSON.parse(init.body) : null;
      calls.push({ url, body });
      if (body?.paths) {
        return new Response(JSON.stringify(body.paths.map((p: string) => ({ error: null, path: p, signedURL: `/object/sign/media/${p}?token=t-${p}` }))), { status: 200 });
      }
      return new Response(JSON.stringify({ signedURL: `/object/sign/media/single?token=s` }), { status: 200 });
    });
    return { svc, calls };
  }

  it('30 adjuntos → UNA petición POST /object/sign/{bucket} con paths; después las URLs salen de la caché', async () => {
    const { svc, calls } = supabaseService();
    const list = paths(30);
    await svc.primeSignedUrls(list);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://x.supabase.test/storage/v1/object/sign/media');
    expect(calls[0]!.body).toEqual({ expiresIn: 3600, paths: list });
    const urls = await Promise.all(list.map((p) => svc.createSignedUrl(p)));
    expect(calls).toHaveLength(1);
    expect(urls[3]).toBe('https://x.supabase.test/storage/v1/object/sign/media/2026/11/obj-3.png?token=t-2026/11/obj-3.png');
    await svc.primeSignedUrls(list);
    expect(calls).toHaveLength(1);
  });

  it('más de 100 rutas se parten en lotes de 100', async () => {
    const { svc, calls } = supabaseService();
    await svc.primeSignedUrls(paths(230));
    expect(calls.map((c) => c.body.paths.length)).toEqual([100, 100, 30]);
  });

  it('la caché caduca a los ~50 min y volver a pedir firma de nuevo', async () => {
    const { svc, calls } = supabaseService();
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    await svc.createSignedUrl('a.png');
    await svc.createSignedUrl('a.png');
    expect(calls).toHaveLength(1);
    spy.mockReturnValue(now + SIGNED_URL_CACHE_MS + 1000);
    await svc.createSignedUrl('a.png');
    expect(calls).toHaveLength(2);
  });

  it('borrar un objeto saca su URL de la caché; con `download` no se cachea', async () => {
    const { svc, calls } = supabaseService();
    await svc.createSignedUrl('b.png');
    vi.spyOn(SupabaseStorageDriver.prototype, 'remove').mockResolvedValue();
    await svc.remove(['b.png']);
    await svc.createSignedUrl('b.png');
    expect(calls).toHaveLength(2);
    await svc.createSignedUrl('b.png', 3600, { download: 'x.png' });
    await svc.createSignedUrl('b.png', 3600, { download: 'x.png' });
    expect(calls).toHaveLength(4);
  });

  it('si el lote falla, cada ruta se firma por separado (no se rompe la respuesta)', async () => {
    const svc = new StorageService();
    (svc as any).driver = new SupabaseStorageDriver('https://x.supabase.test', 'k', 'media');
    let n = 0;
    vi.stubGlobal('fetch', async (_u: string, init: any) => {
      n++;
      const body = JSON.parse(init.body);
      return body.paths ? new Response('boom', { status: 500 }) : new Response(JSON.stringify({ signedURL: '/object/sign/media/p?token=1' }), { status: 200 });
    });
    await svc.primeSignedUrls(paths(3));
    expect(await svc.createSignedUrl('2026/11/obj-0.png')).toContain('token=1');
    expect(n).toBe(2);
  });

  it('driver local: createSignedUrls equivale a firmar una a una', async () => {
    const svc = env.t.app.get(StorageService);
    const m = await svc.createSignedUrls(['2026/11/a.png', '2026/11/b.png'], 3600);
    expect([...m.keys()]).toEqual(['2026/11/a.png', '2026/11/b.png']);
    for (const url of m.values()) expect(url).toMatch(/^\/storage\/v1\/object\/sign\/[^/]+\/2026\/11\/[ab]\.png\?exp=\d+&sig=[0-9a-f]+$/);
  });
});

describe('F4c #18 · bandeja y biblioteca firman en lote', () => {
  it('el timeline de una conversación con 12 adjuntos hace una sola firma en lote', async () => {
    const admin = await loginAs(env.t, ADMIN_EMAIL);
    const { conversation } = await seedConversation(env.t);
    const media = env.t.app.get(MediaService);
    for (let i = 0; i < 12; i++) {
      const m = await media.storeBuffer(Buffer.concat([PNG_1X1, Buffer.from([i])]), 'image/png', `f${i}.png`, 'INBOUND');
      await env.t.prisma.message.create({ data: { conversationId: conversation.id, direction: 'INBOUND', kind: 'IMAGE', mediaId: m.id, status: 'RECEIVED' as any, wamid: `wamid.img${i}` } });
    }
    const driver = env.t.app.get(StorageService).driver;
    const batch = vi.spyOn(driver, 'createSignedUrls');
    const r = await admin.get(`/api/conversations/${conversation.id}/timeline`);
    expect(r.status).toBe(200);
    expect(r.body.items.filter((i: any) => i.message?.media?.url)).toHaveLength(12);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]![0]).toHaveLength(12);
    // segunda lectura: todo sale de la caché, sin volver a firmar
    await admin.get(`/api/conversations/${conversation.id}/timeline`);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('la lista de la biblioteca firma sus archivos en una sola llamada', async () => {
    const admin = await loginAs(env.t, ADMIN_EMAIL);
    for (let i = 0; i < 6; i++) {
      const up = await admin.agent
        .post('/api/library/files')
        .set('X-Requested-With', 'XMLHttpRequest')
        .attach('file', Buffer.concat([PNG_1X1, Buffer.from([i])]), { filename: `img${i}.png`, contentType: 'image/png' });
      expect(up.status, JSON.stringify(up.body)).toBe(201);
    }
    const driver = env.t.app.get(StorageService).driver;
    // las subidas ya firmaron (caché): vaciarla para medir la lista
    (env.t.app.get(StorageService) as any).signed.clear();
    const batch = vi.spyOn(driver, 'createSignedUrls');
    const r = await admin.get('/api/library/files');
    expect(r.body).toHaveLength(6);
    expect(batch).toHaveBeenCalledTimes(1);
  });
});

describe('F4c B9 · la biblioteca audita subir y borrar con IP', () => {
  it('library_upload y library_delete quedan registrados con usuario e IP', async () => {
    const admin = await loginAs(env.t, ADMIN_EMAIL);
    const up = await admin.agent.post('/api/library/files').set('X-Requested-With', 'XMLHttpRequest').field('name', 'Catálogo').attach('file', Buffer.from('%PDF-1.4 x'), { filename: 'c.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect((await admin.del(`/api/library/files/${up.body.id}`)).status).toBe(200);
    const rows = await env.t.prisma.auditLog.findMany({ where: { action: { in: ['library_upload', 'library_delete'] } }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['library_upload', 'library_delete']);
    for (const r of rows) {
      expect(r.userId).toBe(admin.user.id);
      expect(r.ip).toBeTruthy();
      expect(r.entityId).toBe(up.body.id);
    }
  });
});

describe('F4c B8 · descarga firmada del adaptador local con nombre no ASCII', () => {
  it('?download=Łódź.png responde 200 con filename*', async () => {
    const svc = env.t.app.get(StorageService);
    const media = env.t.app.get(MediaService);
    const m = await media.storeBuffer(PNG_1X1, 'image/png', 'a.png', 'LIBRARY');
    const url = await svc.createSignedUrl(m.storagePath, 3600, { download: 'Łódź ñ.png' });
    const res = await env.t.http.get(url);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''%C5%81%C3%B3d%C5%BA%20%C3%B1\.png$/);
  });
});

/**
 * F4a · Media y cabeceras: B4 lista blanca de MIME, B5 ffmpeg, B6 descargas de Meta, B10 Cache-Control, B11 CSP.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ADMIN_EMAIL, loginAs } from './utils/app';
import { createWaTestEnv, PNG_1X1, type WaTestEnv } from './meta-simulator/harness';
import { resetConfigCache } from '../src/common/config';
import { WhatsAppApiError, WhatsAppGateway, isAllowedMediaUrl } from '../src/modules/whatsapp/whatsapp.gateway';
import { convertToOggOpusMono, ffmpegArgs, ffmpegBinary, ffmpegInputFormat } from '../src/modules/media/audio-convert';
import { safeInboundMime } from '../src/modules/media/mime';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});

/** Servidor HTTP mínimo para simular hosts de Meta y comportamientos raros. */
async function serve(handler: http.RequestListener) {
  const srv = http.createServer(handler);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, close: () => new Promise<void>((r) => srv.close(() => r())) };
}
async function withGraphBase<T>(base: string, fn: () => Promise<T>): Promise<T> {
  resetConfigCache({ META_GRAPH_BASE_URL: base });
  try {
    return await fn();
  } finally {
    resetConfigCache({ META_GRAPH_BASE_URL: env.sim.baseUrl });
  }
}

describe('F4a · B4 lista blanca de MIME entrantes', () => {
  it('safeInboundMime deja pasar los tipos de WhatsApp y el resto es application/octet-stream', () => {
    expect(safeInboundMime('image/jpeg')).toBe('image/jpeg');
    expect(safeInboundMime('Audio/OGG; codecs=opus')).toBe('audio/ogg');
    expect(safeInboundMime('image/webp')).toBe('image/webp');
    for (const bad of ['text/html', 'image/svg+xml', 'application/javascript', 'application/x-msdownload', '', null, undefined]) {
      expect(safeInboundMime(bad as any)).toBe('application/octet-stream');
    }
  });

  it('un adjunto entrante que dice ser HTML se guarda como application/octet-stream', async () => {
    const mid = env.sim.addInboundMedia(Buffer.from('<script>alert(1)</script>'), 'text/html');
    await env.sim.sendInbound({ from: '34600111222', type: 'document', document: { id: mid, mime_type: 'text/html', filename: 'a.html' } });
    const m = await env.t.prisma.message.findFirstOrThrow({ include: { media: true } });
    expect(m.media!.mimeType).toBe('application/octet-stream');
  });
});

describe('F4a · B5 ffmpeg', () => {
  it('fuerza el demuxer según el MIME y limita los protocolos a file,pipe antes de -i', () => {
    expect(ffmpegInputFormat('audio/webm; codecs=opus')).toBe('matroska');
    expect(ffmpegInputFormat('audio/ogg')).toBe('ogg');
    expect(ffmpegInputFormat('video/mp4')).toBeNull();
    const args = ffmpegArgs('matroska', 'in.bin', 'out.ogg');
    const i = args.indexOf('-i');
    expect(args.slice(args.indexOf('-protocol_whitelist'), args.indexOf('-protocol_whitelist') + 2)).toEqual(['-protocol_whitelist', 'file,pipe']);
    expect(args.indexOf('-protocol_whitelist')).toBeLessThan(i);
    expect(args.indexOf('-f')).toBeLessThan(i);
    expect(args[args.indexOf('-f') + 1]).toBe('matroska');
  });

  it('un «audio» que en realidad es una lista HLS que apunta a un archivo local no se lee', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'f4a-'));
    try {
      const secret = path.join(dir, 'secreto.txt');
      execFileSync('sh', ['-c', `echo secreto > ${secret}`]);
      const hls = Buffer.from(`#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1,\n${secret}\n#EXT-X-ENDLIST\n`);
      await expect(convertToOggOpusMono(hls, 'audio/webm')).rejects.toBeTruthy();
      await expect(convertToOggOpusMono(hls, 'text/html')).rejects.toThrow(/no admitido/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un webm/opus legítimo se convierte a OGG/Opus', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'f4a-'));
    try {
      const f = path.join(dir, 'a.webm');
      execFileSync(ffmpegBinary(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', '-c:a', 'libopus', f]);
      const out = await convertToOggOpusMono(readFileSync(f), 'audio/webm');
      expect(out.subarray(0, 4).toString()).toBe('OggS');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F4a · B6 descargas de media y paginación de plantillas', () => {
  it('isAllowedMediaUrl: solo https y hosts de Meta (y el simulador fuera de producción)', () => {
    const base = 'https://graph.facebook.com';
    for (const ok of ['https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', 'https://mmg.whatsapp.net/v/t62/x', 'https://scontent.xx.fbcdn.net/a', 'https://graph.facebook.com/v23.0/1']) {
      expect(isAllowedMediaUrl(ok, base, 'production'), ok).toBe(true);
    }
    for (const bad of ['http://lookaside.fbsbx.com/x', 'https://evil.example.com/x', 'https://fbsbx.com.evil.com/x', 'https://evilfbsbx.com/x', 'https://user:pw@lookaside.fbsbx.com/x', 'file:///etc/passwd', 'no es una url']) {
      expect(isAllowedMediaUrl(bad, base, 'production'), bad).toBe(false);
    }
    expect(isAllowedMediaUrl('http://127.0.0.1:4010/_media/1', 'http://127.0.0.1:4010', 'test')).toBe(true);
    expect(isAllowedMediaUrl('http://127.0.0.1:4010/_media/1', 'http://127.0.0.1:4010', 'production')).toBe(false);
    expect(isAllowedMediaUrl('http://127.0.0.1:9999/x', 'http://127.0.0.1:4010', 'test')).toBe(false);
  });

  it('downloadMedia no sale a un host que no es de Meta ni manda el token', async () => {
    let hits = 0;
    const other = await serve((_req, res) => {
      hits++;
      res.end('x');
    });
    try {
      const gw = env.t.app.get(WhatsAppGateway);
      await expect(gw.downloadMedia(`${other.url}/robo`)).rejects.toMatchObject({ retryable: false });
      await expect(gw.downloadMedia('https://evil.example.com/x')).rejects.toBeInstanceOf(WhatsAppApiError);
      expect(hits).toBe(0);
    } finally {
      await other.close();
    }
  });

  it('downloadMedia no sigue redirecciones (redirect: error)', async () => {
    let target = 0;
    const srv = await serve((req, res) => {
      if (req.url === '/final') {
        target++;
        res.end('x');
      } else {
        res.writeHead(302, { Location: '/final' }).end();
      }
    });
    try {
      await withGraphBase(srv.url, async () => {
        await expect(env.t.app.get(WhatsAppGateway).downloadMedia(`${srv.url}/inicio`)).rejects.toBeInstanceOf(WhatsAppApiError);
      });
      expect(target).toBe(0);
    } finally {
      await srv.close();
    }
  });

  it('downloadMedia respeta el tope de tamaño (Content-Length y lectura por partes)', async () => {
    const srv = await serve((req, res) => {
      if (req.url === '/declarado') {
        res.writeHead(200, { 'Content-Length': '5000' });
        res.end(Buffer.alloc(5000));
      } else if (req.url === '/chunked') {
        res.writeHead(200); // sin Content-Length
        res.write(Buffer.alloc(600));
        res.write(Buffer.alloc(600));
        res.end(Buffer.alloc(600));
      } else {
        res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG_1X1);
      }
    });
    try {
      await withGraphBase(srv.url, async () => {
        const gw = env.t.app.get(WhatsAppGateway);
        await expect(gw.downloadMedia(`${srv.url}/declarado`, 1000)).rejects.toMatchObject({ retryable: false, info: { es: expect.stringMatching(/máximo/) } });
        await expect(gw.downloadMedia(`${srv.url}/chunked`, 1000)).rejects.toMatchObject({ retryable: false });
        const ok = await gw.downloadMedia(`${srv.url}/ok`, 1000);
        expect(ok.data.equals(PNG_1X1)).toBe(true);
        expect(ok.mimeType).toBe('image/png');
      });
    } finally {
      await srv.close();
    }
  });

  it('listTemplates ignora un paging.next de otro origen (no se le manda el token)', async () => {
    let evil = 0;
    const attacker = await serve((_req, res) => {
      evil++;
      res.end('{}');
    });
    const graph = await serve((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: '1', name: 'a', status: 'APPROVED', category: 'MARKETING', language: 'es', components: [] }], paging: { next: `${attacker.url}/steal` } }));
    });
    try {
      await withGraphBase(graph.url, async () => {
        const list = await env.t.app.get(WhatsAppGateway).listTemplates();
        expect(list).toHaveLength(1);
      });
      expect(evil).toBe(0);
    } finally {
      await graph.close();
      await attacker.close();
    }
  });

  it('listTemplates sí sigue un paging.next del mismo origen', async () => {
    const graph = await serve((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const u = new URL(req.url!, 'http://x');
      if (u.searchParams.get('after')) res.end(JSON.stringify({ data: [{ id: '2', name: 'b' }], paging: {} }));
      else res.end(JSON.stringify({ data: [{ id: '1', name: 'a' }], paging: { next: `${graph.url}${req.url}&after=1` } }));
    });
    try {
      await withGraphBase(graph.url, async () => {
        expect((await env.t.app.get(WhatsAppGateway).listTemplates()).map((t) => t.id)).toEqual(['1', '2']);
      });
    } finally {
      await graph.close();
    }
  });
});

describe('F4a · B10 Cache-Control y B11 CSP', () => {
  it('/api/* lleva private, no-cache y conserva ETag/304', async () => {
    const s = await loginAs(env.t, ADMIN_EMAIL);
    const r = await s.get('/api/users');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-cache');
    expect(r.headers.etag).toBeTruthy();
    const again = await s.agent.get('/api/users').set('If-None-Match', r.headers.etag!);
    expect(again.status).toBe(304);
    expect(again.headers['cache-control']).toBe('private, no-cache');
  });

  it('/api/auth/* y las exportaciones CSV llevan no-store; también con otra capitalización de la ruta', async () => {
    const s = await loginAs(env.t, ADMIN_EMAIL);
    expect((await s.get('/api/auth/me')).headers['cache-control']).toBe('no-store');
    const login = await env.t.http.post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: ADMIN_EMAIL, password: 'mala' });
    expect(login.headers['cache-control']).toBe('no-store');
    const csv = await s.get('/api/contacts/export');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['cache-control']).toBe('no-store');
    expect((await s.get('/API/Auth/me')).headers['cache-control']).toBe('no-store');
  });

  it('CSP: connect-src solo \'self\' (sin ws: ni wss: a cualquier host)', async () => {
    const r = await env.t.http.get('/health');
    const csp = String(r.headers['content-security-policy']);
    const connect = /connect-src ([^;]*)/.exec(csp)![1]!;
    expect(connect).toBe("'self'");
    expect(csp).not.toMatch(/\bwss?:/);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ADMIN_EMAIL, loginAs } from './utils/app';
import { createWaTestEnv, PNG_1X1, seedConversation, type WaTestEnv } from './meta-simulator/harness';
import { QUEUES } from '../src/modules/jobs/jobs.service';
import { MediaService } from '../src/modules/media/media.service';
import { MessagingService } from '../src/modules/whatsapp/messaging.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { ffmpegBinary } from '../src/modules/media/audio-convert';

let env: WaTestEnv;
beforeAll(async () => {
  env = await createWaTestEnv();
});
afterAll(async () => env.close());
beforeEach(async () => {
  await env.t.reset();
  env.clear();
});

const FROM = '34600111222';
const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

describe('S1 · Media entrante (prueba 3)', () => {
  it('descarga el adjunto al llegar, lo guarda en Storage y enlaza el mensaje', async () => {
    const mid = env.sim.addInboundMedia(PNG_1X1, 'image/png');
    await env.sim.sendInbound({ from: FROM, type: 'image', image: { id: mid, mime_type: 'image/png', caption: 'Foto' } });
    const m = await env.t.prisma.message.findFirstOrThrow({ include: { media: true } });
    expect(m.media).toMatchObject({ source: 'INBOUND', mimeType: 'image/png', sizeBytes: PNG_1X1.length });
    expect(m.media!.sha256).toHaveLength(64);
    expect(m.media!.storagePath).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]+\.png$/);
    const stored = await env.t.app.get(StorageService).download(m.media!.storagePath);
    expect(stored.equals(PNG_1X1)).toBe(true);
    // el DTO refrescado ya trae URL firmada y no está pendiente
    const last = env.realtime.emitted.filter((e) => e.event === 'message.created').at(-1)!.payload as any;
    expect(last.notify).toBe(false);
    expect(last.message.media.url).toMatch(/storage\/v1\/object\/sign\/media\//);
    expect(last.message.media.pending).toBeUndefined();
    // la URL firmada se puede abrir
    const url = new URL(last.message.media.url, env.appUrl);
    const dl = await fetch(url);
    expect(dl.status).toBe(200);
    expect(Buffer.from(await dl.arrayBuffer()).equals(PNG_1X1)).toBe(true);
  });

  it('URL de Meta caducada → se pide de nuevo la información y se descarga', async () => {
    const mid = env.sim.addInboundMedia(PNG_1X1, 'image/png');
    env.sim.expireMedia(mid, 2);
    await env.sim.sendInbound({ from: FROM, type: 'image', image: { id: mid, mime_type: 'image/png' } });
    const m = await env.t.prisma.message.findFirstOrThrow();
    expect(m.mediaId).not.toBeNull();
    expect(env.t.jobs.inlineErrors).toHaveLength(0);
  });

  it('si el media ya no existe en Meta, el mensaje se conserva pendiente y se puede reintentar', async () => {
    const mid = env.sim.addInboundMedia(PNG_1X1, 'image/png');
    env.sim.deleteMedia(mid);
    await env.sim.sendInbound({ from: FROM, type: 'image', image: { id: mid, mime_type: 'image/png' } });
    const m = await env.t.prisma.message.findFirstOrThrow();
    expect(m.mediaId).toBeNull();
    expect(env.t.jobs.inlineErrors.some((e) => e.queue === QUEUES.WA_MEDIA_DOWNLOAD)).toBe(true);
    env.sim.media.get(mid)!.deleted = false;
    await env.t.jobs.runInline(QUEUES.WA_MEDIA_DOWNLOAD, { messageId: m.id });
    expect((await env.t.prisma.message.findUniqueOrThrow({ where: { id: m.id } })).mediaId).not.toBeNull();
    // idempotente
    await env.t.jobs.runInline(QUEUES.WA_MEDIA_DOWNLOAD, { messageId: m.id });
    expect(await env.t.prisma.mediaFile.count()).toBe(1);
  });
});

describe('S1 · Subida de archivos POST /api/media (prueba 3)', () => {
  it('exige sesión', async () => {
    const r = await env.t.http.post('/api/media').set(CSRF).attach('file', PNG_1X1, { filename: 'a.png', contentType: 'image/png' });
    expect(r.status).toBe(401);
  });

  it('acepta una imagen válida y devuelve MediaDto con URL firmada; GET /:id/url da otra', async () => {
    const s = await loginAs(env.t, ADMIN_EMAIL);
    const r = await s.agent.post('/api/media').set(CSRF).attach('file', PNG_1X1, { filename: 'Logotipo ñandú.png', contentType: 'image/png' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ mimeType: 'image/png', sizeBytes: PNG_1X1.length, fileName: 'Logotipo ñandú.png' });
    expect(r.body.url).toContain('/storage/v1/object/sign/media/');
    const row = await env.t.prisma.mediaFile.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(row.source).toBe('UPLOAD');
    const u = await s.get(`/api/media/${r.body.id}/url`);
    expect(u.status).toBe(200);
    expect(u.body.url).toContain('/storage/v1/object/sign/media/');
    expect((await s.get('/api/media/no-es-uuid/url')).status).toBe(400);
    expect((await s.get('/api/media/00000000-0000-4000-8000-000000000000/url')).status).toBe(404);
  });

  it('tipo no permitido o tamaño excesivo → error claro en español', async () => {
    const s = await loginAs(env.t, ADMIN_EMAIL);
    const webp = await s.agent.post('/api/media').set(CSRF).attach('file', Buffer.from('RIFFxxxxWEBP'), { filename: 'a.webp', contentType: 'image/webp' });
    expect(webp.status).toBe(400);
    expect(webp.body.message).toMatch(/Tipo de archivo no admitido por WhatsApp/);
    const exe = await s.agent.post('/api/media').set(CSRF).attach('file', Buffer.from('MZ'), { filename: 'a.exe', contentType: 'application/x-msdownload' });
    expect(exe.status).toBe(400);
    const big = await s.agent.post('/api/media').set(CSRF).attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'grande.jpg', contentType: 'image/jpeg' });
    expect(big.status).toBe(400);
    expect(big.body.message).toBe('El archivo supera el máximo de 5 MB para image');
    const none = await s.agent.post('/api/media').set(CSRF);
    expect(none.status).toBe(400);
    expect(await env.t.prisma.mediaFile.count()).toBe(0);
  });

  it('sendMedia rechaza un archivo no válido antes de crear ningún mensaje', async () => {
    const { conversation } = await seedConversation(env.t);
    const media = env.t.app.get(MediaService);
    const f = await media.storeBuffer(Buffer.from('RIFFxxxxWEBP'), 'image/webp', 'a.webp', 'UPLOAD');
    await expect(env.t.app.get(MessagingService).sendMedia(conversation.id, [f.id])).rejects.toMatchObject({ response: { message: expect.stringMatching(/no admitido/) } });
    expect(await env.t.prisma.message.count()).toBe(0);
  });
});

describe('S1 · Subida a WhatsApp y notas de voz', () => {
  it('ensureWaMediaId sube una vez y reutiliza el id; vuelve a subir si caducó', async () => {
    const media = env.t.app.get(MediaService);
    const f = await media.storeBuffer(PNG_1X1, 'image/png', 'a.png', 'UPLOAD');
    const id1 = await media.ensureWaMediaId(f.id);
    const id2 = await media.ensureWaMediaId(f.id);
    expect(id2).toBe(id1);
    expect(env.sim.media.size).toBe(1);
    const row = await env.t.prisma.mediaFile.findUniqueOrThrow({ where: { id: f.id } });
    expect(row.waMediaId).toBe(id1);
    const days = (row.waMediaIdExpiresAt!.getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(28.9);
    expect(days).toBeLessThanOrEqual(29);
    await env.t.prisma.mediaFile.update({ where: { id: f.id }, data: { waMediaIdExpiresAt: new Date(Date.now() - 1000) } });
    const id3 = await media.ensureWaMediaId(f.id);
    expect(id3).not.toBe(id1);
    expect(env.sim.media.size).toBe(2);
  });

  it('nota de voz webm/opus del navegador → se convierte a OGG/Opus mono y se envía como audio (kind VOICE)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gelado-test-'));
    try {
      const webm = path.join(dir, 'in.webm');
      execFileSync(ffmpegBinary(), ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ac', '2', '-c:a', 'libopus', '-f', 'webm', webm]);
      const s = await loginAs(env.t, ADMIN_EMAIL);
      const up = await s.agent.post('/api/media').set(CSRF).attach('file', readFileSync(webm), { filename: 'nota.webm', contentType: 'audio/webm;codecs=opus' });
      expect(up.status).toBe(201);

      const { conversation } = await seedConversation(env.t);
      const [msg] = await env.t.app.get(MessagingService).sendMedia(conversation.id, [up.body.id], { voice: true });
      expect(msg!.kind).toBe('VOICE');
      expect(msg!.status).toBe('SENT');
      const sent = env.sim.sent.at(-1)!.body;
      expect(sent.type).toBe('audio');
      const uploaded = [...env.sim.media.values()][0]!;
      expect(uploaded.mime).toBe('audio/ogg');
      expect(uploaded.data.subarray(0, 4).toString()).toBe('OggS');
      // comprobar que es Opus mono
      const ogg = path.join(dir, 'out.ogg');
      require('node:fs').writeFileSync(ogg, uploaded.data);
      let info = '';
      try {
        execFileSync(ffmpegBinary(), ['-hide_banner', '-i', ogg], { stdio: 'pipe' });
      } catch (e: any) {
        info = String(e.stderr);
      }
      expect(info).toMatch(/Audio: opus/);
      expect(info).toMatch(/mono/);
      const dto = env.realtime.emitted.find((e) => e.event === 'message.created')!.payload as any;
      expect(dto.message.kind).toBe('VOICE');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Notas de voz de cada navegador: Chrome graba audio/webm;codecs=opus, Firefox audio/ogg;codecs=opus y Safari/iOS
 * audio/mp4 (AAC). Todas deben subirse, convertirse a OGG/Opus mono y salir hacia Meta (simulador) como nota de voz.
 * Fixtures: apps/api/test/fixtures/audio (generar-audio.sh).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ADMIN_EMAIL, loginAs } from './utils/app';
import { createWaTestEnv, seedConversation, type WaTestEnv } from './meta-simulator/harness';
import { convertToOggOpusMono, sniffAudioFormat } from '../src/modules/media/audio-convert';
import { normalizeUploadMime } from '../src/modules/media/mime';

const FX = path.join(__dirname, 'fixtures', 'audio');
const fx = (n: string) => readFileSync(path.join(FX, n));

/** Lo que cada navegador sube: archivo, MIME tal como lo declara (con parámetros) y nombre. */
const BROWSERS = [
  { name: 'Chrome (webm/opus)', file: 'voz-chrome.webm', mime: 'audio/webm;codecs=opus', upName: 'nota-de-voz.webm', container: 'matroska' },
  { name: 'Chrome sin codec declarado', file: 'voz-chrome.webm', mime: 'audio/webm', upName: 'nota-de-voz.webm', container: 'matroska' },
  { name: 'Firefox (ogg/opus)', file: 'voz-firefox.ogg', mime: 'audio/ogg;codecs=opus', upName: 'nota-de-voz.ogg', container: 'ogg' },
  { name: 'Safari macOS (mp4/AAC fragmentado)', file: 'voz-safari.mp4', mime: 'audio/mp4', upName: 'nota-de-voz.m4a', container: 'mov' },
  { name: 'Safari con codec declarado', file: 'voz-safari.mp4', mime: 'audio/mp4;codecs=mp4a.40.2', upName: 'nota-de-voz.m4a', container: 'mov' },
  { name: 'Safari iOS (m4a/AAC estéreo)', file: 'voz-ios.m4a', mime: 'audio/mp4', upName: 'nota-de-voz.m4a', container: 'mov' },
  { name: 'MIME alternativo audio/x-m4a', file: 'voz-ios.m4a', mime: 'audio/x-m4a', upName: 'nota-de-voz.m4a', container: 'mov' },
] as const;

/** Cabecera OpusHead de un Ogg/Opus: versión, canales, frecuencia original. */
function opusHead(ogg: Buffer) {
  expect(ogg.subarray(0, 4).toString('latin1')).toBe('OggS');
  const i = ogg.indexOf('OpusHead');
  expect(i, 'el audio de salida debe llevar la cabecera OpusHead').toBeGreaterThan(0);
  return { version: ogg[i + 8]!, channels: ogg[i + 9]!, inputRate: ogg.readUInt32LE(i + 12) };
}
function probe(buf: Buffer) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gelado-probe-'));
  try {
    const f = path.join(dir, 'a.ogg');
    writeFileSync(f, buf);
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,channels,sample_rate:format=format_name,duration', '-of', 'json', f]).toString();
    const j = JSON.parse(out);
    return { codec: j.streams[0].codec_name as string, channels: j.streams[0].channels as number, rate: Number(j.streams[0].sample_rate), format: j.format.format_name as string, duration: Number(j.format.duration) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const expectOpusMono = (ogg: Buffer) => {
  expect(opusHead(ogg).channels).toBe(1);
  expect(probe(ogg)).toMatchObject({ codec: 'opus', channels: 1, rate: 48000, format: 'ogg' });
  expect(probe(ogg).duration).toBeGreaterThan(1.2);
  expect(probe(ogg).duration).toBeLessThan(2);
};

describe('Conversión de notas de voz: cada formato de navegador sale como OGG/Opus mono', () => {
  it.each(BROWSERS)('$name', async ({ file, mime }) => {
    const out = await convertToOggOpusMono(fx(file), mime);
    expectOpusMono(out);
  });

  it('los fixtures son pequeños y de los contenedores esperados', () => {
    for (const b of BROWSERS) {
      const buf = fx(b.file);
      expect(buf.length).toBeLessThan(20_000);
      expect(sniffAudioFormat(buf)).toBe(b.container);
    }
  });

  it('un MIME mal declarado no rompe la nota: el contenedor se reconoce por los bytes', async () => {
    expectOpusMono(await convertToOggOpusMono(fx('voz-safari.mp4'), 'audio/webm'));
    expectOpusMono(await convertToOggOpusMono(fx('voz-chrome.webm'), 'audio/mp4'));
    expectOpusMono(await convertToOggOpusMono(fx('voz-firefox.ogg'), 'audio/webm;codecs=opus'));
  });

  it('lo que no es audio se rechaza (no se pasa a ffmpeg con un demuxer inventado)', async () => {
    await expect(convertToOggOpusMono(Buffer.from('esto no es audio'), 'audio/webm')).rejects.toBeTruthy();
    await expect(convertToOggOpusMono(fx('voz-chrome.webm'), 'image/png').then(() => 'ok')).resolves.toBe('ok'); // los bytes mandan sobre el MIME
    await expect(convertToOggOpusMono(Buffer.from('xxxxxxxxxxxx'), 'image/png')).rejects.toThrow(/no admitido/);
  });

  it('normalizeUploadMime quita parámetros, pasa a minúsculas y reconoce alias de m4a', () => {
    expect(normalizeUploadMime('Audio/WebM; codecs=opus')).toBe('audio/webm');
    expect(normalizeUploadMime('audio/mp4;codecs=mp4a.40.2')).toBe('audio/mp4');
    expect(normalizeUploadMime('audio/x-m4a')).toBe('audio/mp4');
    expect(normalizeUploadMime('audio/m4a')).toBe('audio/mp4');
    expect(normalizeUploadMime('text/html')).toBe('text/html');
  });
});

describe('Envío completo de una nota de voz por la API contra el simulador de Meta', () => {
  let env: WaTestEnv;
  beforeAll(async () => {
    env = await createWaTestEnv();
  });
  afterAll(async () => env.close());
  beforeEach(async () => {
    await env.t.reset();
    env.clear();
  });
  const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

  it.each(BROWSERS)('$name: sube, se convierte y llega a Meta como audio OGG/Opus mono (VOICE)', async ({ file, mime, upName }) => {
    const s = await loginAs(env.t, ADMIN_EMAIL);
    const up = await s.agent.post('/api/media').set(CSRF).attach('file', fx(file), { filename: upName, contentType: mime });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    // se guarda con el MIME sin parámetros y la extensión que corresponde
    expect(up.body.mimeType).toMatch(/^audio\/(webm|ogg|mp4)$/);
    expect(up.body.mimeType).not.toContain(';');

    const { conversation } = await seedConversation(env.t);
    const r = await s.post(`/api/conversations/${conversation.id}/messages`, { type: 'media', mediaFileIds: [up.body.id], voice: true });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ kind: 'VOICE', direction: 'OUTBOUND' });

    expect(env.sim.sent).toHaveLength(1);
    const sent = env.sim.sent[0]!.body;
    expect(sent.type).toBe('audio');
    const uploaded = env.sim.media.get(sent.audio.id)!;
    expect(uploaded.mime).toBe('audio/ogg');
    expectOpusMono(uploaded.data);

    // el MediaFile enviado es el OGG convertido; el original se conserva
    const msg = await env.t.prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id, direction: 'OUTBOUND' }, include: { media: true } });
    expect(msg.media).toMatchObject({ mimeType: 'audio/ogg' });
    expect(msg.media!.fileName).toMatch(/\.ogg$/);
    expect(msg.media!.id).not.toBe(up.body.id);
    expect(await env.t.prisma.mediaFile.findUnique({ where: { id: up.body.id } })).toBeTruthy();
  });

  it('el límite de 16 MB de audio se aplica a la subida', async () => {
    const s = await loginAs(env.t, ADMIN_EMAIL);
    const big = Buffer.concat([fx('voz-chrome.webm'), Buffer.alloc(16 * 1024 * 1024)]);
    const up = await s.agent.post('/api/media').set(CSRF).attach('file', big, { filename: 'larga.webm', contentType: 'audio/webm;codecs=opus' });
    expect(up.status).toBe(400);
    expect(up.body.message).toMatch(/16 MB/);
  });

  it('un archivo que no es audio subido como nota de voz falla con un mensaje claro y no sale nada hacia Meta', async () => {
    const s = await loginAs(env.t, ADMIN_EMAIL);
    const up = await s.agent.post('/api/media').set(CSRF).attach('file', Buffer.from('no soy audio'), { filename: 'nota.webm', contentType: 'audio/webm' });
    expect(up.status).toBe(201);
    const { conversation } = await seedConversation(env.t);
    const r = await s.post(`/api/conversations/${conversation.id}/messages`, { type: 'media', mediaFileIds: [up.body.id], voice: true });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/nota de voz/);
    expect(env.sim.sent).toHaveLength(0);
  });
});

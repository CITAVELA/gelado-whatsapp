// Notas de voz: formato de grabación y nombre/tipo del archivo en cada navegador.
import { describe, expect, it } from 'vitest';
import { RECORDER_MIMES, baseType, pickRecorderMime, voiceFile } from './voice';

const supports = (...ok: string[]) => (m: string) => ok.includes(m);
const blob = (type: string, n = 100) => new Blob([new Uint8Array(n)], { type });

describe('formato de grabación por navegador', () => {
  it('Firefox: ogg/opus', () => expect(pickRecorderMime(supports('audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'))).toBe('audio/ogg;codecs=opus'));
  it('Chrome / Edge: webm/opus', () => expect(pickRecorderMime(supports('audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'))).toBe('audio/webm;codecs=opus'));
  it('Safari (mp4/AAC)', () => expect(pickRecorderMime(supports('audio/mp4', 'audio/mp4;codecs=mp4a.40.2'))).toBe('audio/mp4;codecs=mp4a.40.2'));
  it('Safari que solo declara audio/mp4', () => expect(pickRecorderMime(supports('audio/mp4'))).toBe('audio/mp4'));
  it('sin isTypeSupported o sin ningún formato: que elija el navegador', () => {
    expect(pickRecorderMime(undefined)).toBeUndefined();
    expect(pickRecorderMime(supports())).toBeUndefined();
  });
  it('si isTypeSupported lanza, se salta ese formato', () => {
    expect(pickRecorderMime((m) => { if (m.startsWith('audio/ogg')) throw new Error('x'); return m === 'audio/mp4'; })).toBe('audio/mp4');
  });
  it('todos los formatos candidatos son de audio y los admite el servidor', () => {
    for (const m of RECORDER_MIMES) expect(baseType(m)).toMatch(/^audio\/(ogg|webm|mp4)$/);
  });
});

describe('archivo de la nota de voz', () => {
  it.each([
    ['Chrome', 'audio/webm;codecs=opus', 'audio/webm', 'nota-de-voz.webm'],
    ['Firefox', 'audio/ogg; codecs=opus', 'audio/ogg', 'nota-de-voz.ogg'],
    ['Safari macOS', 'audio/mp4', 'audio/mp4', 'nota-de-voz.m4a'],
    ['Safari con codec', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'nota-de-voz.m4a'],
    ['mayúsculas', 'Audio/WebM;Codecs=Opus', 'audio/webm', 'nota-de-voz.webm'],
  ])('%s: tipo sin parámetros y extensión coherente', (_n, rec, type, name) => {
    const f = voiceFile([blob(rec)], rec, rec)!;
    expect(f.type).toBe(type);
    expect(f.name).toBe(name);
    expect(f.type).not.toContain(';');
  });

  it('si el grabador no informa del tipo (algunos Safari), se usa el del primer trozo y luego el formato pedido', () => {
    expect(voiceFile([blob('audio/mp4')], '', 'audio/webm;codecs=opus')!.type).toBe('audio/mp4');
    const f = voiceFile([blob('')], '', 'audio/mp4;codecs=mp4a.40.2')!;
    expect(f.type).toBe('audio/mp4');
    expect(f.name).toBe('nota-de-voz.m4a');
  });

  it('un tipo raro (video/mp4, application/octet-stream) cae al pedido y, sin nada, a webm', () => {
    expect(voiceFile([blob('')], 'video/mp4', 'audio/mp4')!.type).toBe('audio/mp4');
    expect(voiceFile([blob('')], undefined, undefined)!.type).toBe('audio/webm');
  });

  it('sin datos grabados no hay archivo', () => {
    expect(voiceFile([], 'audio/webm', 'audio/webm')).toBeNull();
    expect(voiceFile([new Blob([], { type: 'audio/webm' })], 'audio/webm')).toBeNull();
  });
});

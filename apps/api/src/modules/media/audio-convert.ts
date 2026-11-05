import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { baseMime } from './mime';

/** ffmpeg-static; si no está disponible en la plataforma, el `ffmpeg` del sistema (docs/04). */
export function ffmpegBinary(): string {
  if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic;
  return 'ffmpeg';
}

/** Demuxer de entrada de ffmpeg para cada MIME de audio admitido. */
const INPUT_FORMAT_BY_MIME: Record<string, string> = {
  'audio/webm': 'matroska',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'mov',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
};

/** Demuxer de entrada para un MIME de audio; null si no se admite (nunca se deja que ffmpeg lo adivine). */
export function ffmpegInputFormat(mime: string): string | null {
  return INPUT_FORMAT_BY_MIME[baseMime(mime)] ?? null;
}

/**
 * Argumentos de ffmpeg. El formato de entrada se fuerza según el MIME (si no, ffmpeg lo detecta por contenido y un
 * «audio» HLS/concat podría leer archivos locales) y el protocolo se limita a `file,pipe`: ni red ni otros esquemas.
 */
export function ffmpegArgs(format: string, inFile: string, outFile: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y', '-nostdin',
    '-protocol_whitelist', 'file,pipe',
    '-f', format, '-i', inFile,
    '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-f', 'ogg', outFile,
  ];
}

/**
 * Convierte un audio (webm/opus del navegador, ogg, m4a…) a OGG/Opus mono, el formato de las notas de voz
 * de WhatsApp. Usa archivos temporales (algunos contenedores no se pueden leer por tubería).
 */
export async function convertToOggOpusMono(input: Buffer, inputMime = 'audio/webm'): Promise<Buffer> {
  const format = ffmpegInputFormat(inputMime);
  if (!format) throw new Error(`Formato de audio no admitido: ${inputMime}`);
  const dir = await mkdtemp(path.join(tmpdir(), 'gelado-voice-'));
  try {
    const inFile = path.join(dir, 'in.bin');
    const outFile = path.join(dir, 'out.ogg');
    await writeFile(inFile, input);
    await run(ffmpegBinary(), ffmpegArgs(format, inFile, outFile));
    const out = await readFile(outFile);
    if (!out.length) throw new Error('ffmpeg no generó audio');
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += String(d)));
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error('ffmpeg tardó demasiado'));
    }, 60_000);
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`ffmpeg terminó con código ${code}: ${err.slice(-500)}`));
    });
  });
}

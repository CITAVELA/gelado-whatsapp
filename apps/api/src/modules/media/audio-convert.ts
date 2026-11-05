import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

/** ffmpeg-static; si no está disponible en la plataforma, el `ffmpeg` del sistema (docs/04). */
export function ffmpegBinary(): string {
  if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic;
  return 'ffmpeg';
}

/**
 * Convierte un audio (webm/opus del navegador, ogg, m4a…) a OGG/Opus mono, el formato de las notas de voz
 * de WhatsApp. Usa archivos temporales (algunos contenedores no se pueden leer por tubería).
 */
export async function convertToOggOpusMono(input: Buffer, inputExt = 'webm'): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'gelado-voice-'));
  try {
    const inFile = path.join(dir, `in.${inputExt.replace(/[^a-z0-9]/gi, '') || 'webm'}`);
    const outFile = path.join(dir, 'out.ogg');
    await writeFile(inFile, input);
    await run(ffmpegBinary(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', inFile, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-f', 'ogg', outFile]);
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

// Grabación de notas de voz con MediaRecorder.
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Formatos de grabación por orden de preferencia. Cada navegador soporta los suyos: Firefox ogg/opus, Chrome y Edge
 * webm/opus, Safari (macOS e iOS) mp4/AAC (las versiones nuevas también webm/opus). El servidor admite los tres y siempre
 * los convierte a OGG/Opus mono antes de enviarlos a WhatsApp.
 */
export const RECORDER_MIMES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];
const EXT: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a' };

/** `audio/webm;codecs=opus` → `audio/webm` (los parámetros no deben viajar en el tipo del archivo subido). */
export const baseType = (mime: string | undefined | null) => (mime ?? '').split(';')[0]!.trim().toLowerCase();

/** Primer formato de la lista que el navegador sabe grabar; undefined → que elija el navegador. */
export function pickRecorderMime(isSupported: ((m: string) => boolean) | undefined): string | undefined {
  if (typeof isSupported !== 'function') return undefined;
  return RECORDER_MIMES.find((m) => {
    try { return isSupported(m); } catch { return false; }
  });
}

/**
 * Archivo a subir con lo grabado. El tipo sale de lo que el grabador dice haber producido (`recorder.mimeType`), no de
 * lo que se pidió; si viene vacío (algún Safari), del primer trozo y, por último, del formato elegido.
 */
export function voiceFile(chunks: Blob[], recorderMime: string | undefined, requestedMime?: string): File | null {
  const type = [recorderMime, chunks[0]?.type, requestedMime].map(baseType).find((t) => t in EXT) ?? 'audio/webm';
  const blob = new Blob(chunks, { type });
  return blob.size ? new File([blob], `nota-de-voz.${EXT[type]}`, { type }) : null;
}

export function voiceSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export function useVoiceRecorder() {
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const requested = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    rec.current = null;
    setRecording(false);
  }, []);
  useEffect(() => () => { try { rec.current?.stop(); } catch { /* ya parado */ } cleanup(); }, [cleanup]);

  /** Empieza a grabar; lanza si no hay micrófono o se deniega el permiso. */
  const start = useCallback(async () => {
    if (!voiceSupported()) throw new Error('Este navegador no permite grabar audio');
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.current = s;
    const mime = pickRecorderMime(typeof MediaRecorder.isTypeSupported === 'function' ? (m) => MediaRecorder.isTypeSupported(m) : undefined);
    requested.current = mime;
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
    } catch {
      try { r = new MediaRecorder(s); requested.current = undefined; } catch (e) { s.getTracks().forEach((t) => t.stop()); stream.current = null; throw e; }
    }
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.start();
    rec.current = r;
    setSeconds(0);
    setRecording(true);
    timer.current = setInterval(() => setSeconds((x) => x + 1), 1000);
  }, []);

  /** Para y devuelve el archivo (null si no hay nada grabado). */
  const stop = useCallback(
    () =>
      new Promise<File | null>((resolve) => {
        const r = rec.current;
        if (!r) return resolve(null);
        r.onstop = () => {
          const file = voiceFile(chunks.current, r.mimeType, requested.current);
          cleanup();
          resolve(file);
        };
        try { r.stop(); } catch { cleanup(); resolve(null); }
      }),
    [cleanup],
  );

  const cancel = useCallback(() => {
    const r = rec.current;
    if (r) { r.onstop = null; try { r.stop(); } catch { /* ya parado */ } }
    cleanup();
  }, [cleanup]);

  return { recording, seconds, start, stop, cancel };
}

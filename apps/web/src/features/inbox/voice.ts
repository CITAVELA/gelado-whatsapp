// Grabación de notas de voz con MediaRecorder.
import { useCallback, useEffect, useRef, useState } from 'react';

const MIMES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
const EXT: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a' };

export function voiceSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export function useVoiceRecorder() {
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
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
    const mime = MIMES.find((m) => MediaRecorder.isTypeSupported?.(m));
    const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
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
          const type = (r.mimeType || 'audio/webm').split(';')[0]!;
          const blob = new Blob(chunks.current, { type });
          cleanup();
          resolve(blob.size ? new File([blob], `nota-de-voz.${EXT[type] ?? 'webm'}`, { type }) : null);
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

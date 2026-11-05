import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

function bars(seed: string, n = 28): number[] {
  let h = 2166136261;
  for (let i = 0; i < Math.min(seed.length, 200); i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return Array.from({ length: n }, () => {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    return 5 + (h % 16);
  });
}
const mmss = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

/** Reproductor de audio / nota de voz con forma de onda simple (clic en la onda para saltar). */
export function AudioPlayer({ src, seed, label = 'nota de voz' }: { src: string; seed?: string; label?: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const heights = useMemo(() => bars(seed ?? src), [seed, src]);

  useEffect(() => () => audio.current?.pause(), []);
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setPlaying(false));
    else a.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audio.current;
    if (!a || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur;
  };
  const ratio = dur ? time / dur : 0;
  return (
    <div className="voice">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setTime(0); }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
      />
      <button type="button" className="play" aria-label={playing ? `Pausar ${label}` : `Reproducir ${label}`} onClick={toggle}>
        {playing ? <Icon name="pause" small /> : <Icon name="play" small />}
      </button>
      <div className="wave" role="slider" aria-label="Posición" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} onClick={seek}>
        {heights.map((h, i) => (
          <i key={i} style={{ height: h, background: i / heights.length < ratio ? 'var(--ink)' : undefined }} />
        ))}
      </div>
      <span className="hint mono">{playing || time > 0 ? mmss(time) : mmss(dur)}</span>
    </div>
  );
}

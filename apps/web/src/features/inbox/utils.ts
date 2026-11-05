// Utilidades puras de la bandeja (fechas en Europe/Madrid, teléfonos, vista previa, ventana de 24 h).
import { APP_TZ, WINDOW_MS, zonedParts, zonedTimeToUtc, type MessageKind, type SnoozeDto } from '@gelado/shared';

const TZ = APP_TZ;

const p2 = (n: number) => String(n).padStart(2, '0');
/** «Hoy», «Ayer» o la fecha dd/mm/aaaa para el separador del historial. */
export function fmtDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: TZ });
  if (day(d) === day(now)) return 'Hoy';
  if (day(d) === day(new Date(now.getTime() - 86400000))) return 'Ayer';
  const z = zonedParts(d);
  return `${p2(z.day)}/${p2(z.month)}/${z.year}`;
}
/** «16/10, 09:23» */
export function fmtShortDateTime(iso: string): string {
  const z = zonedParts(new Date(iso));
  return `${p2(z.day)}/${p2(z.month)}, ${p2(z.hour)}:${p2(z.minute)}`;
}
/** Clave de día en Madrid para agrupar mensajes. */
export function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}

/** +34 612 345 678 (solo agrupa los números españoles; el resto se deja como viene). */
export function fmtPhone(e164: string): string {
  const m = /^\+34(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return m ? `+34 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
export function isPhoneLike(s: string): boolean {
  return /^\+?[\d\s]{6,}$/.test(s);
}
/** Nombre a mostrar: el del contacto o el teléfono formateado. */
export function displayLabel(name: string, phoneE164: string): string {
  return !name || isPhoneLike(name) ? fmtPhone(phoneE164) : name;
}
/** Iniciales del avatar verde; «+34» si solo hay teléfono. */
export function waInitials(name: string, phoneE164: string): string {
  if (!name || isPhoneLike(name)) return phoneE164.startsWith('+') ? phoneE164.slice(0, 3) : '#';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

/** Milisegundos que quedan de ventana de 24 h (≤ 0 si está cerrada). */
export function windowRemainingMs(expiresAt: string | null | undefined, now = Date.now()): number {
  if (!expiresAt) return 0;
  return new Date(expiresAt).getTime() - now;
}
export function isWindowOpen(c: { windowExpiresAt: string | null; windowOpen?: boolean }, now = Date.now()): boolean {
  if (c.windowExpiresAt) return windowRemainingMs(c.windowExpiresAt, now) > 0;
  return !!c.windowOpen;
}
/** La ventana caduca en menos de 2 h (y sigue abierta). */
export function windowExpiresSoon(expiresAt: string | null | undefined, now = Date.now()): boolean {
  const ms = windowRemainingMs(expiresAt, now);
  return ms > 0 && ms < 2 * 3600_000;
}
export { WINDOW_MS };
/** «22 h», «45 min» */
export function remainingText(ms: number): string {
  if (ms <= 0) return '0 min';
  const h = Math.floor(ms / 3600_000);
  return h >= 1 ? `${h} h` : `${Math.max(1, Math.round(ms / 60_000))} min`;
}

/** Texto de apoyo para notificaciones y vistas previas según el tipo. */
export const KIND_PREVIEW: Partial<Record<MessageKind, string>> = {
  IMAGE: 'Foto', AUDIO: 'Audio', VOICE: 'Nota de voz', VIDEO: 'Vídeo', DOCUMENT: 'Documento', STICKER: 'Sticker',
  LOCATION: 'Ubicación', CONTACTS: 'Contacto', TEMPLATE: 'Plantilla', REACTION: 'Reacción', UNSUPPORTED: 'Mensaje no soportado',
};
export function previewIcon(kind: MessageKind | null): string | null {
  switch (kind) {
    case 'IMAGE': case 'STICKER': return 'image';
    case 'VIDEO': return 'play';
    case 'AUDIO': case 'VOICE': return 'mic';
    case 'DOCUMENT': return 'file';
    case 'TEMPLATE': return 'templates';
    case 'LOCATION': return 'map';
    case 'NOTE': return 'edit';
    default: return null;
  }
}

// ── Posponer ──
export interface SnoozeOption { preset: Exclude<SnoozeDto['preset'], 'custom'>; label: string; at: Date; hint: string }

/** Opciones de «Posponer» con la fecha que resulta (hora de Madrid). */
export function snoozeOptions(now = new Date()): SnoozeOption[] {
  const p = zonedParts(now);
  const addDays = (n: number) => {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n, 12));
    return d.toISOString().slice(0, 10);
  };
  const tomorrow = zonedTimeToUtc(addDays(1), '08:00');
  const idx = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(p.weekday);
  const daysToMonday = idx === 0 ? 7 : 7 - idx;
  const monday = zonedTimeToUtc(addDays(daysToMonday), '08:00');
  const h1 = new Date(now.getTime() + 3600_000);
  const d1 = new Date(now.getTime() + 86400_000);
  const w1 = new Date(now.getTime() + 7 * 86400_000);
  const time = (d: Date) => { const z = zonedParts(d); return `${p2(z.hour)}:${p2(z.minute)}`; };
  return [
    { preset: 'tomorrow8', label: 'Mañana', at: tomorrow, hint: fmtShortDateTime(tomorrow.toISOString()) },
    { preset: 'monday8', label: 'Lunes', at: monday, hint: fmtShortDateTime(monday.toISOString()) },
    { preset: '1h', label: '1 hora', at: h1, hint: `a las ${time(h1)}` },
    { preset: '1d', label: '1 día', at: d1, hint: fmtShortDateTime(d1.toISOString()) },
    { preset: '1w', label: '1 semana', at: w1, hint: fmtShortDateTime(w1.toISOString()) },
  ];
}

/** «2026-11-06» + «08:00» (hora de Madrid) → ISO UTC */
export function madridToIso(ymd: string, hhmm: string): string {
  return zonedTimeToUtc(ymd, hhmm).toISOString();
}
export function madridYmd(d = new Date()): string {
  return zonedParts(d).ymd;
}

/** Tarifa estimada de un envío de plantilla según categoría. */
export function fmtRate(n: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
}

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}

export function fileExt(name: string | null | undefined, mime?: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name ?? '');
  if (m) return m[1]!.toUpperCase();
  if (mime === 'application/pdf') return 'PDF';
  return 'DOC';
}

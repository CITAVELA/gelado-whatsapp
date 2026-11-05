// Utilidades de hora en Europe/Madrid (independientes del TZ del servidor).

export const APP_TZ = 'Europe/Madrid';
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAY_ES: Record<Weekday, string> = {
  mon: 'Lunes', tue: 'Martes', wed: 'Miércoles', thu: 'Jueves', fri: 'Viernes', sat: 'Sábado', sun: 'Domingo',
};

/** Partes de fecha/hora en la zona indicada. */
export function zonedParts(date: Date, tz = APP_TZ) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const wd = String(p.weekday).toLowerCase().slice(0, 3) as Weekday;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second),
    weekday: wd,
    /** "YYYY-MM-DD" en la zona */
    ymd: `${p.year}-${p.month}-${p.day}`,
    /** minutos desde medianoche en la zona */
    minutes: (Number(p.hour) % 24) * 60 + Number(p.minute),
  };
}

/** Convierte una fecha-hora local de Madrid (YYYY-MM-DD, HH:mm) en Date UTC (maneja cambio de hora). */
export function zonedTimeToUtc(ymd: string, hhmm: string, tz = APP_TZ): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = asUtc - Date.UTC(y, m - 1, d, hh, mm);
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

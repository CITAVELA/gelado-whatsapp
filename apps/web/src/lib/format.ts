// Formatos en español, zona Europe/Madrid.
const TZ = 'Europe/Madrid';

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
/** Hora si es hoy, «Ayer», día de la semana esta semana, o fecha. */
export function fmtListTime(iso: string | null | undefined, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: TZ });
  if (day(d) === day(now)) return fmtTime(iso);
  const y = new Date(now.getTime() - 86400000);
  if (day(d) === day(y)) return 'Ayer';
  if (now.getTime() - d.getTime() < 6 * 86400000) return d.toLocaleDateString('es-ES', { timeZone: TZ, weekday: 'short' });
  return d.toLocaleDateString('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit' });
}
/** «6.560»: en es-ES Intl no agrupa los números de 4 cifras salvo con useGrouping 'always' (F-19). */
const NUM = new Intl.NumberFormat('es-ES', { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);
export function fmtNumber(n: number) {
  return NUM.format(n);
}
export function fmtPct(part: number, total: number) {
  if (!total) return '0 %';
  return `${Math.round((part / total) * 100)} %`;
}
export function fmtEur(n: number | null | undefined) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n ?? 0);
}
export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n / 1024 / 1024)} MB`;
}
/** Tiempo restante legible: «22 h», «45 min» */
export function fmtRemaining(untilIso: string | null | undefined, now = Date.now()) {
  if (!untilIso) return '';
  const ms = new Date(untilIso).getTime() - now;
  if (ms <= 0) return '0 min';
  const h = Math.floor(ms / 3600000);
  return h >= 1 ? `${h} h` : `${Math.max(1, Math.round(ms / 60000))} min`;
}
export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

/** Idioma de una plantilla en español: «es» → «Español», «ca» → «Catalán», «en_US» → «Inglés». */
const LANG_ES: Record<string, string> = { es: 'Español', ca: 'Catalán', en: 'Inglés', fr: 'Francés', pt: 'Portugués', it: 'Italiano', de: 'Alemán' };
export function fmtLanguage(code: string | null | undefined) {
  if (!code) return '—';
  return LANG_ES[code.toLowerCase().split(/[_-]/)[0]!] ?? code;
}
/** Estado de la verificación del nombre que devuelve Meta (en inglés) → español. */
const NAME_STATUS_ES: Record<string, string> = {
  APPROVED: 'aprobado',
  AVAILABLE_WITHOUT_REVIEW: 'disponible',
  DECLINED: 'rechazado',
  EXPIRED: 'caducado',
  PENDING_REVIEW: 'pendiente de revisión',
  NONE: 'sin verificar',
};
export function fmtNameStatus(status: string | null | undefined) {
  if (!status) return '';
  return NAME_STATUS_ES[status.toUpperCase()] ?? 'en revisión';
}

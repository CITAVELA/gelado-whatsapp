import type { QualityRating } from '@gelado/shared';

export const QUALITY_ES: Record<QualityRating, string> = { GREEN: 'Alta', YELLOW: 'Media', RED: 'Baja', UNKNOWN: 'Sin datos' };
export const QUALITY_PILL: Record<QualityRating, string> = { GREEN: 'p-ok', YELLOW: 'p-warn', RED: 'p-bad', UNKNOWN: 'p-grey' };
export const PHONE_STATUS_ES: Record<string, string> = {
  CONNECTED: 'Conectado',
  FLAGGED: 'Marcado por Meta',
  RESTRICTED: 'Restringido',
  PENDING: 'Pendiente',
  DISCONNECTED: 'Desconectado',
  UNKNOWN: 'Desconocido',
};
export const CATEGORY_ES: Record<string, string> = {
  marketing: 'Marketing (campañas y plantillas)',
  utility: 'Utilidad',
  authentication: 'Autenticación',
  service: 'Respuestas (servicio)',
  marketing_lite: 'Marketing',
  authentication_international: 'Autenticación internacional',
};
export const TIER_ES: Record<string, string> = { TIER_250: '250', TIER_1K: '1.000', TIER_2K: '2.000', TIER_10K: '10.000', TIER_100K: '100.000', TIER_UNLIMITED: 'Ilimitado' };

/** Tarifa con hasta 4 decimales: «0,0585 €». */
export function fmtRate(n: number) {
  return `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n)} €`;
}

export function monthKey(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }).slice(0, 7);
}
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function monthName(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-ES', { month: 'long', timeZone: 'UTC' });
}
export function monthLabel(month: string) {
  const [y] = month.split('-');
  return `${monthName(month)} ${y}`;
}

/** Clase de la barra de uso según el porcentaje. */
export function barClass(pct: number) {
  return pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok';
}

/** Entero con separador de miles también en 4 cifras (es-ES por defecto no agrupa «2000»): «2.000». */
export function fmtInt(n: number) {
  const opts = { useGrouping: 'always', maximumFractionDigits: 0 } as unknown as Intl.NumberFormatOptions;
  return new Intl.NumberFormat('es-ES', opts).format(n);
}

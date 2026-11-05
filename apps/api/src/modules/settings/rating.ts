import type { QualityRating } from '@gelado/shared';

export function normalizeRating(r: unknown): QualityRating {
  const v = String(r ?? '').toUpperCase();
  return v === 'GREEN' || v === 'YELLOW' || v === 'RED' ? v : 'UNKNOWN';
}

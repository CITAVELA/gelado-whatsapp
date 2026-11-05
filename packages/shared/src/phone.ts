import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

export interface NormalizedPhone {
  ok: true;
  e164: string;         // +34617498222
  waId: string;         // 34617498222 (sin +, como lo manda Meta)
  country?: string;
  isMobile: boolean | undefined;
}
export interface InvalidPhone {
  ok: false;
  reason: string;
}

/**
 * Normaliza un teléfono a E.164 (regla 1 de 05). País por defecto: ES.
 * Acepta 617498222, +34 617 49 82 22, 0034617498222, 34617498222, (34) 617-498-222…
 */
export function normalizePhone(input: string | null | undefined, defaultCountry: CountryCode = 'ES'): NormalizedPhone | InvalidPhone {
  if (input == null) return { ok: false, reason: 'Teléfono vacío' };
  let s = String(input).trim();
  if (!s) return { ok: false, reason: 'Teléfono vacío' };
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  // 34XXXXXXXXX sin + (11 dígitos empezando por 34 y móvil/fijo español)
  if (!s.startsWith('+') && defaultCountry === 'ES' && /^34[6789]\d{8}$/.test(s)) s = '+' + s;
  // wa_id de otros países (más de 10 dígitos, sin +): se intenta como internacional
  if (!s.startsWith('+') && s.length > 10) {
    const intl = parsePhoneNumberFromString('+' + s);
    if (intl?.isValid()) s = '+' + s;
  }
  const parsed = parsePhoneNumberFromString(s, defaultCountry);
  if (!parsed || !parsed.isValid()) return { ok: false, reason: 'Teléfono no válido' };
  const type = parsed.getType();
  return {
    ok: true,
    e164: parsed.number,
    waId: parsed.number.replace(/^\+/, ''),
    country: parsed.country,
    isMobile: type === undefined ? undefined : type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE',
  };
}

/** wa_id de Meta (34617498222) → E.164 (+34617498222). */
export function waIdToE164(waId: string): string {
  const n = normalizePhone('+' + waId.replace(/^\+/, ''));
  return n.ok ? n.e164 : '+' + waId.replace(/^\+/, '');
}

/** Formato legible: +34 617 49 82 22 */
export function formatPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
}

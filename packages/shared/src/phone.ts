import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

/**
 * Avisos de un teléfono válido (se importa igualmente):
 * - FOREIGN: país distinto de España (revisar).
 * - LANDLINE: fijo español en la columna de móvil (probablemente sin WhatsApp).
 */
export type PhoneWarning = 'FOREIGN' | 'LANDLINE';

export const PHONE_WARNING_ES: Record<PhoneWarning, string> = {
  FOREIGN: 'País distinto de España: revisar',
  LANDLINE: 'Fijo español: probablemente sin WhatsApp',
};

export interface NormalizedPhone {
  ok: true;
  e164: string;         // +34617498222
  waId: string;         // 34617498222 (sin +, como lo manda Meta)
  country?: string;
  isMobile: boolean | undefined;
  warning?: PhoneWarning;
  /** true si el número venía como «+» + 9 dígitos españoles (Superchat) y se ha convertido a +34… */
  correctedFromPlus?: boolean;
}
export interface InvalidPhone {
  ok: false;
  reason: string;
  /** INCOMPLETE_ES: «+» + 8 dígitos de móvil/fijo español al que le falta una cifra */
  code?: 'EMPTY' | 'INCOMPLETE_ES' | 'INVALID';
}

export interface NormalizePhoneOptions {
  /**
   * Reglas de la exportación de Superchat: «+» + exactamente 9 dígitos (6–9…) válidos como número español → +34…, y
   * «+» + 8 dígitos (6–9…) → incompleto. Activadas por defecto; el wa_id de Meta las desactiva.
   */
  superchatPlus?: boolean;
}

/**
 * Normaliza un teléfono a E.164 (regla 1 de 05). País por defecto: ES.
 * Acepta 617498222, +34 617 49 82 22, 0034617498222, 34617498222, (34) 617-498-222…
 */
export function normalizePhone(input: string | null | undefined, defaultCountry: CountryCode = 'ES', opts: NormalizePhoneOptions = {}): NormalizedPhone | InvalidPhone {
  if (input == null) return { ok: false, reason: 'Teléfono vacío', code: 'EMPTY' };
  let s = String(input).trim();
  if (!s) return { ok: false, reason: 'Teléfono vacío', code: 'EMPTY' };
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  let correctedFromPlus = false;
  if (defaultCountry === 'ES' && opts.superchatPlus !== false) {
    // Superchat guardó ~70 móviles españoles como «+6XXXXXXXX»: con el + sale un país ficticio (Nueva Caledonia, Tokelau…)
    const nine = /^\+([6-9]\d{8})$/.exec(s);
    if (nine) {
      const es = parsePhoneNumberFromString(nine[1]!, 'ES');
      if (es?.isValid() && es.country === 'ES') {
        s = '+34' + nine[1];
        correctedFromPlus = true;
      }
    } else if (/^\+[6-9]\d{7}$/.test(s)) {
      return { ok: false, reason: 'Teléfono español incompleto', code: 'INCOMPLETE_ES' };
    }
  }
  // 34XXXXXXXXX sin + (11 dígitos empezando por 34 y móvil/fijo español)
  if (!s.startsWith('+') && defaultCountry === 'ES' && /^34[6789]\d{8}$/.test(s)) s = '+' + s;
  // wa_id de otros países (más de 10 dígitos, sin +): se intenta como internacional
  if (!s.startsWith('+') && s.length > 10) {
    const intl = parsePhoneNumberFromString('+' + s);
    if (intl?.isValid()) s = '+' + s;
  }
  const parsed = parsePhoneNumberFromString(s, defaultCountry);
  if (!parsed || !parsed.isValid()) return { ok: false, reason: 'Teléfono no válido', code: 'INVALID' };
  const type = parsed.getType();
  const out: NormalizedPhone = {
    ok: true,
    e164: parsed.number,
    waId: parsed.number.replace(/^\+/, ''),
    country: parsed.country,
    isMobile: type === undefined ? undefined : type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE',
  };
  if (correctedFromPlus) out.correctedFromPlus = true;
  if (parsed.country && parsed.country !== defaultCountry) out.warning = 'FOREIGN';
  else if (parsed.country === 'ES' && defaultCountry === 'ES' && type === 'FIXED_LINE') out.warning = 'LANDLINE';
  return out;
}

/** wa_id de Meta (34617498222) → E.164 (+34617498222). */
export function waIdToE164(waId: string): string {
  const n = normalizePhone('+' + waId.replace(/^\+/, ''), 'ES', { superchatPlus: false });
  return n.ok ? n.e164 : '+' + waId.replace(/^\+/, '');
}

/** Formato legible: +34 617 49 82 22 */
export function formatPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
}

export interface NormalizedLandline {
  value: string | null;
  /** true si estaba en notación científica y no se ha podido reconstruir: se deja tal cual */
  incomplete?: boolean;
  /** true si estaba en notación científica y se ha convertido a dígitos */
  fixedFromScientific?: boolean;
}

const SCI_RE = /^[+-]?(\d+)(?:[.,](\d+))?[eE]\+?(\d+)$/;

/**
 * Teléfono fijo: Excel y Superchat lo guardan a veces en notación científica («9.65123456E8» → 965123456).
 * Si tras convertirlo queda de 9 dígitos se usa; si no, se deja el texto original.
 */
export function normalizeLandline(input: string | null | undefined): NormalizedLandline {
  const raw = (input ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!raw) return { value: null };
  const m = SCI_RE.exec(raw.replace(/\s/g, ''));
  if (!m) return { value: raw };
  const int = m[1]!;
  const frac = m[2] ?? '';
  const exp = Number(m[3]);
  const shift = exp - frac.length;
  if (shift >= 0 && exp <= 30) {
    const digits = (int + frac + '0'.repeat(shift)).replace(/^0+(?=\d)/, '');
    if (/^[89]\d{8}$/.test(digits)) return { value: digits, fixedFromScientific: true };
  }
  return { value: raw, incomplete: true };
}

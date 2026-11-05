// Detección de bajas (docs/06 · Mensajes entrantes, paso 4).

export const OPT_OUT_PAYLOAD = 'OPT_OUT';
export const OPT_OUT_BUTTON_TEXT = 'No recibir más';
export const OPT_OUT_KEYWORDS = ['baja', 'stop', 'no quiero recibir', 'no quiero recibir mas', 'darme de baja', 'no recibir mas', 'unsubscribe'];
export const OPT_OUT_CONFIRMATION =
  'Te hemos dado de baja de las promociones de Exclusivas Gelado. No volverás a recibir comunicaciones comerciales por WhatsApp. ' +
  'Si quieres seguir hablando con nosotros, escríbenos cuando quieras.';

export function normalizeKeyword(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.!¡¿?,;:"'«»()\s]+/g, ' ')
    .trim();
}

/** El texto es exactamente una palabra clave de baja (sin distinguir mayúsculas ni tildes). */
export function isOptOutKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  const n = normalizeKeyword(text);
  return OPT_OUT_KEYWORDS.some((k) => normalizeKeyword(k) === n);
}

/**
 * Textos de botón de respuesta rápida que cuentan como baja. Lista CERRADA de textos exactos (normalizados:
 * sin tildes, minúsculas, espacios colapsados). Nunca por subcadena: «Ver rebajas», «Bajar catálogo» o
 * «Non-stop» no son una baja.
 */
export const OPT_OUT_BUTTON_TEXTS = ['no recibir mas', 'no recibir mas publicidad', 'darme de baja'];

const OPT_OUT_BUTTON_NORMALIZED = normalizeKeyword(OPT_OUT_BUTTON_TEXT);

/** El texto es exactamente «No recibir más» (sin distinguir mayúsculas ni tildes). */
export function isCanonicalOptOutButtonText(text: string | null | undefined): boolean {
  return !!text && normalizeKeyword(text) === OPT_OUT_BUTTON_NORMALIZED;
}

/** El texto de un botón de respuesta rápida es uno de los de baja admitidos (coincidencia exacta). */
export function isOptOutButtonText(text: string | null | undefined): boolean {
  if (!text) return false;
  const n = normalizeKeyword(text);
  return n === OPT_OUT_BUTTON_NORMALIZED || OPT_OUT_BUTTON_TEXTS.includes(n);
}

/** Etiqueta heredada de Superchat que SIEMPRE es una baja en la importación (P7 de docs/10). */
export const LEGACY_OPT_OUT_LABEL = 'NO PUBLICIDAD';

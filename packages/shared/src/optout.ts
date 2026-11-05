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

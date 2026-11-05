import { normalizePhone, type ImportOptionsDto, type ImportRowIssue } from '@gelado/shared';
import { foldAccents } from './contacts.search';

/** Quita emojis, símbolos y signos sueltos de un nombre; conserva letras con tilde, ñ, dígitos y puntuación normal. */
export function cleanName(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = String(v)
    .normalize('NFC')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}​-‏⁠︎️⃣�]/gu, ' ')
    .replace(/\p{S}/gu, ' ') // símbolos: ★ ♥ © ™ + = < >
    .replace(/[\p{C}]/gu, ' '); // caracteres de control
  // tokens sin ninguna letra ni dígito («-», «•», «*») son ruido (se conserva «&»)
  s = s
    .split(/\s+/)
    .filter((t) => /[\p{L}\p{N}]/u.test(t) || t === '&')
    .join(' ')
    .replace(/^[\s.,;:\-_/\\|]+|[\s,;:\-_/\\|]+$/g, '')
    .trim();
  return s ? s.slice(0, 200) : null;
}

/** DNI, NIE o CIF: mayúsculas, sin espacios, guiones ni puntos. */
export function cleanTaxId(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s ? s.slice(0, 30) : null;
}

export function cleanCode(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim().replace(/\.0+$/, '');
  return s ? s.slice(0, 60) : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function splitLabels(v: string | null | undefined): string[] {
  if (!v) return [];
  const out: string[] = [];
  for (const part of String(v).split(/[,;|/\n]+/)) {
    const n = part.replace(/\s+/g, ' ').trim().toLocaleUpperCase('es');
    if (n && !out.includes(n)) out.push(n.slice(0, 40));
  }
  return out;
}

export interface PlanRow {
  row: number;
  /** filas del archivo que aporta (la primera + las duplicadas unidas) */
  rows: number[];
  phoneE164: string;
  waId: string;
  data: { firstName?: string; lastName?: string; email?: string; company?: string; customerCode?: string; taxId?: string; landline?: string; notes?: string };
  labels: string[];
  optOut: boolean;
}

export interface Analysis {
  plans: PlanRow[];
  issues: ImportRowIssue[];
  emptyRows: number;
  invalidPhone: number;
  duplicatesInFile: number;
}

type Opts = Pick<ImportOptionsDto, 'mapping' | 'defaultCountry' | 'onDuplicate' | 'optOutLabelValues'>;

const optOutKeys = (o: Opts) => new Set(o.optOutLabelValues.map((x) => foldAccents(x).replace(/\s+/g, ' ').trim()));

/** Lee y limpia el archivo según el mapeo (sin tocar la BD). Los números de fila son los del archivo (cabecera = 1). */
export function analyzeRows(rows: Record<string, string>[], o: Opts): Analysis {
  const byField: Record<string, string[]> = {};
  for (const [col, f] of Object.entries(o.mapping)) if (f !== 'ignore') (byField[f] ??= []).push(col);
  const first = (r: Record<string, string>, f: string) => {
    for (const c of byField[f] ?? []) if (r[c]?.trim()) return r[c]!.trim();
    return '';
  };
  const optKeys = optOutKeys(o);
  const issues: ImportRowIssue[] = [];
  const plans = new Map<string, PlanRow>();
  let emptyRows = 0;
  let invalidPhone = 0;
  let duplicatesInFile = 0;

  rows.forEach((r, idx) => {
    const row = idx + 2;
    const mappedValues = Object.keys(byField).flatMap((f) => (byField[f] ?? []).map((c) => r[c] ?? ''));
    if (mappedValues.every((v) => !v.trim())) {
      emptyRows++;
      issues.push({ row, reason: 'Fila vacía (se ignora)', kind: 'skipped' });
      return;
    }
    const rawPhone = first(r, 'phone');
    let n = normalizePhone(rawPhone, o.defaultCountry as any);
    if (!n.ok && /[/;,]|\s{2,}|\sy\s/.test(rawPhone)) {
      // «612345678 / 698765432»: se prueba con el primero
      const firstPart = rawPhone.split(/[/;,]|\s{2,}|\sy\s/)[0]!;
      const alt = normalizePhone(firstPart, o.defaultCountry as any);
      if (alt.ok) n = alt;
    }
    if (!n.ok) {
      invalidPhone++;
      issues.push({ row, reason: rawPhone ? `Teléfono no válido (se descarta la fila)` : 'Sin teléfono (se descarta la fila)', value: rawPhone || undefined, kind: 'skipped' });
      return;
    }

    const data: PlanRow['data'] = {};
    const set = <K extends keyof PlanRow['data']>(k: K, v: string | null) => {
      if (v) data[k] = v as any;
    };
    set('firstName', cleanName(first(r, 'firstName')));
    set('lastName', cleanName(first(r, 'lastName')));
    set('company', cleanName(first(r, 'company')));
    set('taxId', cleanTaxId(first(r, 'taxId')));
    set('customerCode', cleanCode(first(r, 'customerCode')));
    const landline = first(r, 'landline').replace(/\s+/g, ' ').slice(0, 40);
    set('landline', landline || null);
    const notes = first(r, 'notes').slice(0, 5000);
    set('notes', notes || null);
    const email = first(r, 'email').toLowerCase();
    if (email) {
      if (EMAIL_RE.test(email)) data.email = email.slice(0, 200);
      else issues.push({ row, reason: 'Aviso: correo no válido (se ignora)', value: email, kind: 'warning' });
    }

    const labels: string[] = [];
    let optOut = false;
    for (const c of byField.labels ?? []) {
      for (const l of splitLabels(r[c])) {
        if (optKeys.has(foldAccents(l).replace(/\s+/g, ' ').trim())) optOut = true;
        else if (!labels.includes(l)) labels.push(l);
      }
    }

    const prev = plans.get(n.e164);
    if (prev) {
      duplicatesInFile++;
      if (o.onDuplicate === 'skip') {
        issues.push({ row, reason: `Duplicado del teléfono de la fila ${prev.row} (se omite)`, value: n.e164, kind: 'skipped' });
        return;
      }
      // unir: los valores no vacíos de la fila nueva completan o sustituyen a los anteriores
      Object.assign(prev.data, data);
      for (const l of labels) if (!prev.labels.includes(l)) prev.labels.push(l);
      prev.optOut = prev.optOut || optOut;
      prev.rows.push(row);
      issues.push({ row, reason: `Duplicado del teléfono de la fila ${prev.row} (unido)`, value: n.e164, kind: 'merged' });
      return;
    }
    plans.set(n.e164, { row, rows: [row], phoneE164: n.e164, waId: n.waId, data, labels, optOut });
  });

  issues.sort((a, b) => a.row - b.row);
  return { plans: [...plans.values()], issues, emptyRows, invalidPhone, duplicatesInFile };
}

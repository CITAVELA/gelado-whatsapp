import { PHONE_WARNING_ES, normalizeLandline, normalizePhone, withMandatoryOptOut, type ImportIssueCode, type ImportOptionsDto, type ImportRowIssue } from '@gelado/shared';
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
  /** Clave de deduplicación: teléfono (p:), si no hay el correo en minúsculas (e:), si tampoco el código (c:) */
  key: string;
  phoneE164: string | null;
  waId: string | null;
  data: { firstName?: string; lastName?: string; email?: string; company?: string; customerCode?: string; taxId?: string; landline?: string; notes?: string };
  labels: string[];
  optOut: boolean;
}

export interface Analysis {
  plans: PlanRow[];
  issues: ImportRowIssue[];
  emptyRows: number;
  /** Filas descartadas por no tener teléfono válido, correo ni código */
  invalidPhone: number;
  duplicatesInFile: number;
  /** Contactos que se importarán sin teléfono («Sin WhatsApp») */
  withoutWhatsapp: number;
}

type Opts = Pick<ImportOptionsDto, 'mapping' | 'defaultCountry' | 'onDuplicate' | 'optOutLabelValues'>;

// NO PUBLICIDAD cuenta siempre como baja (P7), aunque la lista de opciones no lo traiga
const optOutKeys = (o: Opts) => new Set(withMandatoryOptOut(o.optOutLabelValues).map((x) => foldAccents(x).replace(/\s+/g, ' ').trim()));

export function countByCode(issues: ImportRowIssue[]): Partial<Record<ImportIssueCode, number>> {
  const out: Partial<Record<ImportIssueCode, number>> = {};
  for (const i of issues) if (i.code) out[i.code] = (out[i.code] ?? 0) + 1;
  return out;
}

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
  const plans: PlanRow[] = [];
  const byPhone = new Map<string, PlanRow>();
  const byEmail = new Map<string, PlanRow>();
  const byCode = new Map<string, PlanRow>();
  let emptyRows = 0;
  let invalidPhone = 0;
  let duplicatesInFile = 0;

  rows.forEach((r, idx) => {
    const row = idx + 2;
    const mappedValues = Object.keys(byField).flatMap((f) => (byField[f] ?? []).map((c) => r[c] ?? ''));
    if (mappedValues.every((v) => !v.trim())) {
      emptyRows++;
      issues.push({ row, reason: 'Fila vacía (se ignora)', kind: 'skipped', code: 'EMPTY_ROW' });
      return;
    }
    const warn = (code: ImportIssueCode, reason: string, value?: string) => issues.push({ row, reason: `Aviso: ${reason}`, value, kind: 'warning', code });

    // ── Datos de contacto: correo y código (con el teléfono deciden si la fila se importa) ──
    const data: PlanRow['data'] = {};
    const set = <K extends keyof PlanRow['data']>(k: K, v: string | null) => {
      if (v) data[k] = v as any;
    };
    const email = first(r, 'email').toLowerCase();
    if (email) {
      if (EMAIL_RE.test(email)) data.email = email.slice(0, 200);
      else warn('EMAIL_INVALID', 'correo no válido (se ignora)', email);
    }
    set('customerCode', cleanCode(first(r, 'customerCode')));

    // ── Teléfono ──
    const rawPhone = first(r, 'phone');
    let n = normalizePhone(rawPhone, o.defaultCountry as any);
    if (!n.ok && /[/;,]|\s{2,}|\sy\s/.test(rawPhone)) {
      // «612345678 / 698765432»: se prueba con el primero
      const firstPart = rawPhone.split(/[/;,]|\s{2,}|\sy\s/)[0]!;
      const alt = normalizePhone(firstPart, o.defaultCountry as any);
      if (alt.ok) n = alt;
    }
    let originalPhoneNote: string | null = null;
    if (n.ok) {
      if (n.correctedFromPlus) warn('PHONE_CORRECTED', `teléfono corregido a ${n.e164} (venía como «${rawPhone}»)`, rawPhone);
      if (n.warning) warn(n.warning, PHONE_WARNING_ES[n.warning], n.e164);
    } else if (!data.email && !data.customerCode) {
      invalidPhone++;
      const code: ImportIssueCode = !rawPhone ? 'NO_CONTACT' : n.code === 'INCOMPLETE_ES' ? 'PHONE_INCOMPLETE' : 'PHONE_INVALID';
      issues.push({
        row,
        reason: rawPhone ? `${n.reason} y sin correo ni código (se descarta la fila)` : 'Sin teléfono, correo ni código (se descarta la fila)',
        value: rawPhone || undefined, kind: 'skipped', code,
      });
      return;
    } else {
      // P16: sin teléfono válido se importa como «Sin WhatsApp» (con correo y/o código)
      if (rawPhone) {
        originalPhoneNote = `Teléfono original: ${rawPhone}`;
        warn(n.code === 'INCOMPLETE_ES' ? 'PHONE_INCOMPLETE' : 'PHONE_INVALID', `${n.reason}: se importa sin teléfono (Sin WhatsApp)`, rawPhone);
      } else warn('NO_WHATSAPP', 'sin teléfono: se importa como Sin WhatsApp');
    }

    set('firstName', cleanName(first(r, 'firstName')));
    set('lastName', cleanName(first(r, 'lastName')));
    set('company', cleanName(first(r, 'company')));
    set('taxId', cleanTaxId(first(r, 'taxId')));
    const ll = normalizeLandline(first(r, 'landline'));
    set('landline', ll.value);
    if (ll.incomplete) warn('LANDLINE_INCOMPLETE', 'teléfono fijo en notación científica incompleto (se deja tal cual)', ll.value ?? undefined);
    const notes = [first(r, 'notes'), originalPhoneNote].filter(Boolean).join('\n').slice(0, 5000);
    set('notes', notes || null);

    const labels: string[] = [];
    let optOut = false;
    for (const c of byField.labels ?? []) {
      for (const l of splitLabels(r[c])) {
        if (optKeys.has(foldAccents(l).replace(/\s+/g, ' ').trim())) optOut = true;
        else if (!labels.includes(l)) labels.push(l);
      }
    }

    // ── Deduplicación: teléfono; si no hay, correo; si tampoco, código ──
    const e164 = n.ok ? n.e164 : null;
    const key = e164 ? `p:${e164}` : data.email ? `e:${data.email}` : `c:${data.customerCode}`;
    const prev = e164 ? byPhone.get(e164) : data.email ? byEmail.get(data.email) : byCode.get(data.customerCode!);
    if (prev) {
      duplicatesInFile++;
      const what = e164 ? 'teléfono' : data.email ? 'correo' : 'código';
      if (o.onDuplicate === 'skip') {
        issues.push({ row, reason: `Duplicado del ${what} de la fila ${prev.row} (se omite)`, value: e164 ?? data.email ?? data.customerCode, kind: 'skipped', code: 'DUPLICATE_FILE' });
        return;
      }
      // unir: los valores no vacíos de la fila nueva completan o sustituyen a los anteriores
      Object.assign(prev.data, data);
      for (const l of labels) if (!prev.labels.includes(l)) prev.labels.push(l);
      prev.optOut = prev.optOut || optOut;
      prev.rows.push(row);
      issues.push({ row, reason: `Duplicado del ${what} de la fila ${prev.row} (unido)`, value: e164 ?? data.email ?? data.customerCode, kind: 'merged', code: 'DUPLICATE_FILE' });
      return;
    }
    const plan: PlanRow = { row, rows: [row], key, phoneE164: e164, waId: n.ok ? n.waId : null, data, labels, optOut };
    plans.push(plan);
    if (e164) byPhone.set(e164, plan);
    if (data.email && !byEmail.has(data.email)) byEmail.set(data.email, plan);
    if (data.customerCode && !byCode.has(data.customerCode)) byCode.set(data.customerCode, plan);
  });

  issues.sort((a, b) => a.row - b.row);
  return { plans, issues, emptyRows, invalidPhone, duplicatesInFile, withoutWhatsapp: plans.filter((p) => !p.phoneE164).length };
}

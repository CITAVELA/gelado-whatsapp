import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import type { ImportField } from '@gelado/shared';
import { foldAccents } from './contacts.search';

export const MAX_IMPORT_ROWS = 50_000;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export interface ParsedFile {
  columns: string[];
  /** Una entrada por fila de datos (la fila 2 del archivo es rows[0]); incluye filas vacías para conservar la numeración. */
  rows: Record<string, string>[];
}

export type FileKind = 'csv' | 'xlsx';

export function detectKind(fileName: string, data: Buffer): FileKind {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const zip = data.length > 4 && data[0] === 0x50 && data[1] === 0x4b;
  if (ext === 'xlsx' || (zip && ext !== 'csv')) return 'xlsx';
  if (ext === 'xls' || (data.length > 4 && data[0] === 0xd0 && data[1] === 0xcf)) {
    throw new Error('El formato .xls antiguo no se admite: guarda el archivo como .xlsx o .csv');
  }
  return 'csv';
}

function decodeText(data: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}

function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = h.trim() || `Columna ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

function toObjects(table: string[][]): ParsedFile {
  while (table.length && table[table.length - 1]!.every((c) => !String(c ?? '').trim())) table.pop();
  if (!table.length) throw new Error('El archivo está vacío');
  const columns = uniqueHeaders(table[0]!.map((c) => String(c ?? '')));
  const rows = table.slice(1).map((r) => {
    const o: Record<string, string> = {};
    columns.forEach((c, i) => {
      o[c] = String(r[i] ?? '').trim();
    });
    return o;
  });
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`El archivo tiene más de ${MAX_IMPORT_ROWS.toLocaleString('es-ES')} filas`);
  return { columns, rows };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as any;
  if (o.richText) return o.richText.map((t: any) => t.text).join('');
  if (o.result !== undefined) return cellText(o.result);
  if (o.text !== undefined) return cellText(o.text);
  if (o.error) return '';
  return String(v);
}

/** Separador por la cabecera (fuera de comillas): el que más aparece entre «,» «;» tabulador y «|». */
function guessDelimiter(text: string): string {
  const head = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = new Map<string, number>([[',', 0], [';', 0], ['\t', 0], ['|', 0]]);
  let quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ',';
  for (const [d, n] of counts) if (n > counts.get(best)!) best = d;
  return best;
}

export async function parseFile(fileName: string, data: Buffer): Promise<ParsedFile> {
  const kind = detectKind(fileName, data);
  if (kind === 'csv') {
    const text = decodeText(data);
    const res = Papa.parse<string[]>(text, { skipEmptyLines: false, delimiter: guessDelimiter(text) });
    return toObjects(res.data.filter((r) => Array.isArray(r)));
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as any);
  } catch {
    throw new Error('No se puede leer el archivo Excel. Comprueba que es un .xlsx válido');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El Excel no tiene hojas');
  const table: string[][] = [];
  const width = ws.actualColumnCount || ws.columnCount;
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    while (table.length < n - 1) table.push([]);
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
    table.push(cells);
  });
  return toObjects(table);
}

// ── Mapeo sugerido ──

const norm = (s: string) => foldAccents(s).replace(/[^a-z0-9]+/g, ' ').trim();

const RULES: Array<{ field: ImportField; names: string[] }> = [
  { field: 'landline', names: ['telefono fijo', 'fijo', 'tel fijo', 'telefono 2', 'landline'] },
  { field: 'phone', names: ['telefono', 'telefono movil', 'movil', 'tel movil', 'telefono whatsapp', 'whatsapp', 'mobile', 'phone', 'celular', 'tlf', 'tlf movil', 'numero de telefono'] },
  { field: 'firstName', names: ['nombre', 'name', 'first name', 'firstname', 'nombre de pila'] },
  { field: 'lastName', names: ['apellido', 'apellidos', 'last name', 'lastname', 'surname'] },
  { field: 'email', names: ['correo', 'correo electronico', 'direccion de correo electronico', 'email', 'e mail', 'mail', 'direccion de correo'] },
  { field: 'customerCode', names: ['codigo', 'codigo cliente', 'codigo de cliente', 'cod cliente', 'cod', 'id cliente', 'n cliente', 'customer code'] },
  { field: 'taxId', names: ['dni', 'cif', 'nif', 'dni cif', 'cif dni', 'nif cif', 'cif nif', 'nie', 'documento'] },
  { field: 'labels', names: ['listas', 'lista', 'listas de contactos', 'etiqueta', 'etiquetas', 'tags', 'tag', 'grupos', 'grupo'] },
  { field: 'company', names: ['empresa', 'company', 'razon social', 'negocio', 'nombre comercial'] },
  { field: 'notes', names: ['notas', 'nota', 'observaciones', 'comentarios', 'notes'] },
];

export function suggestMapping(columns: string[]): Record<string, ImportField> {
  const out: Record<string, ImportField> = {};
  const used = new Set<ImportField>();
  const normalized = columns.map((c) => norm(c.replace(/\(\d+\)$/, '')));
  // primero coincidencia exacta; después contiene (p. ej. «Teléfono principal»)
  const pick = (i: number, exact: boolean): ImportField | null => {
    const n = normalized[i]!;
    for (const r of RULES) {
      if (r.field !== 'labels' && used.has(r.field)) continue;
      if (exact ? r.names.includes(n) : r.names.some((x) => x.length > 3 && n.includes(x))) return r.field;
    }
    return null;
  };
  columns.forEach((c, i) => {
    const f = pick(i, true);
    if (f) {
      out[c] = f;
      used.add(f);
    }
  });
  columns.forEach((c, i) => {
    if (out[c]) return;
    const f = pick(i, false);
    if (f) {
      out[c] = f;
      used.add(f);
    }
  });
  for (const c of columns) out[c] ??= 'ignore';
  return out;
}

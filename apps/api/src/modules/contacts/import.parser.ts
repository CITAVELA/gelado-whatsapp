import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import type { ImportField } from '@gelado/shared';
import { foldAccents } from './contacts.search';

export const MAX_IMPORT_ROWS = 50_000;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
/** Un .xlsx es un zip: se limita lo que ocupa descomprimido y la proporción, para que una «bomba zip» no agote la memoria. */
export const MAX_XLSX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_XLSX_RATIO = 100;
const MAX_XLSX_ENTRIES = 5_000;
const XLSX_UNREADABLE = 'No se puede leer el archivo Excel. Comprueba que es un .xlsx válido';

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

/**
 * Lee el directorio central del zip (sin descomprimir nada) y rechaza el archivo si, descomprimido, ocuparía más de
 * 50 MB o más de 100 veces lo que pesa comprimido. Debe llamarse ANTES de pasar el buffer a ExcelJS.
 */
export function assertSafeXlsx(data: Buffer): void {
  const tooBig = () => new Error('El archivo Excel es demasiado grande una vez descomprimido (máximo 50 MB) o está demasiado comprimido. Guárdalo de nuevo como .xlsx normal o como .csv');
  // fin del directorio central: firma 0x06054b50 en los últimos 65 557 bytes
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65_535); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(XLSX_UNREADABLE);
  const entries = data.readUInt16LE(eocd + 10);
  const cdSize = data.readUInt32LE(eocd + 12);
  const cdOffset = data.readUInt32LE(eocd + 16);
  // zip64: no lo usa ningún Excel de hasta 10 MB
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw tooBig();
  if (entries > MAX_XLSX_ENTRIES) throw tooBig();
  let pos = cdOffset;
  let uncompressed = 0;
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > data.length || data.readUInt32LE(pos) !== 0x02014b50) throw new Error(XLSX_UNREADABLE);
    const size = data.readUInt32LE(pos + 24);
    if (size === 0xffffffff) throw tooBig();
    uncompressed += size;
    if (uncompressed > MAX_XLSX_UNCOMPRESSED_BYTES) throw tooBig();
    pos += 46 + data.readUInt16LE(pos + 28) + data.readUInt16LE(pos + 30) + data.readUInt16LE(pos + 32);
  }
  if (uncompressed / Math.max(1, data.length) > MAX_XLSX_RATIO) throw tooBig();
}

export async function parseFile(fileName: string, data: Buffer): Promise<ParsedFile> {
  const kind = detectKind(fileName, data);
  if (kind === 'csv') {
    const text = decodeText(data);
    const res = Papa.parse<string[]>(text, { skipEmptyLines: false, delimiter: guessDelimiter(text) });
    return toObjects(res.data.filter((r) => Array.isArray(r)));
  }
  assertSafeXlsx(data);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as any);
  } catch {
    throw new Error(XLSX_UNREADABLE);
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

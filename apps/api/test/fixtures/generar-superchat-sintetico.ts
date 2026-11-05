/**
 * Genera los fixtures SINTÉTICOS de la exportación de Superchat (S12). Todos los datos son inventados
 * (nombres, correos @ejemplo.test, códigos, teléfonos aleatorios): el CSV real de clientes NUNCA entra en el repositorio.
 *
 *   cd apps/api && npx tsx test/fixtures/generar-superchat-sintetico.ts
 *
 * Es reproducible: semilla fija (mulberry32), mismo resultado byte a byte. Escribe:
 *  - superchat-export-sintetico.csv           (6.560 filas, las 15 cabeceras de Superchat + «Notas»)
 *  - superchat-lista-peluqueria-sintetico.csv (40 filas: coinciden con el export, alguna dada de baja y alguna nueva)
 *
 * Proporciones del export (ver `EXPECTED`): 291 sin teléfono (con correo y código), 239 fijos ES en «Teléfono»,
 * 70 «+6XXXXXXXX» (9 dígitos), 16 «+6XXXXXXX» (8 dígitos), 18 extranjeros válidos, Etiquetas vacía en el 99 %,
 * 3 NO PUBLICIDAD, ~110 fijos en notación científica, DNI/NIE/CIF/«-», ~20 nombres con emojis.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePhone } from '@gelado/shared';

export const HEADERS = [
  'ID', 'Nombre', 'Apellido', 'Teléfono', 'Dirección de correo electrónico', 'Etiquetas', 'Código', 'DNI', 'Teléfono Fijo',
  'Género', 'Último mensaje enviado en', 'Último mensaje recibido en', 'IDs de campaña', 'Nombres de campañas', 'Campaña recibida en', 'Notas',
] as const;

export const EXPECTED = {
  total: 6560,
  withWhatsapp: 6253,
  withoutWhatsapp: 307,
  noPhone: 291,
  landlineInPhone: 239,
  plusNine: 70,
  plusEight: 16,
  foreign: 18,
  optOut: 3,
  landlineScientific: 110,
  landlineScientificIncomplete: 4,
  emojiNames: 20,
  transporte: 62,
} as const;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261105);
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join('');
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const FIRST = ['Marisol', 'Lucía', 'Carmen', 'Alba', 'Noelia', 'Rubén', 'Iván', 'Sergio', 'Aitor', 'Nerea', 'Paula', 'Álvaro', 'Beatriz', 'Cristina', 'Dolores', 'Emilio', 'Fátima', 'Gonzalo', 'Héctor', 'Irene', 'Jaime', 'Karina', 'Leire', 'Mónica', 'Nuria', 'Óscar', 'Pilar', 'Raquel', 'Sandra', 'Tomás', 'Úrsula', 'Vicente', 'Yolanda', 'Zoe', 'Ainhoa', 'Bruno', 'Celia', 'Dani', 'Elena', 'Fran'];
const LAST = ['Aranda', 'Bellido', 'Cuesta', 'Dávila', 'Escribano', 'Fontana', 'Garrido', 'Herrero', 'Ibáñez', 'Jurado', 'Lasa', 'Mendizábal', 'Nogales', 'Ortuño', 'Pardo', 'Quintero', 'Rivero', 'Salvatierra', 'Tejada', 'Uriarte', 'Vidal', 'Yáñez', 'Zubiri', 'Núñez', 'Peñalver', 'Albiol', 'Cervera', 'Montoya'];
const EMOJI_NAMES = ['🌸 Marisol', 'Luis ✂️', '💇‍♀️ Carmen', 'Alba 💅', '🔥 Rubén', 'Nuria ✨', '💈 Sergio', 'Paula 🌺', 'Irene 💖', 'Óscar 💈', '🌟 Elena', 'Bea 🌷', 'Dani 🧔', 'Zoe 🦋', 'Fran ✂️', '💄 Cristina', 'Leire 🌼', 'Aitor 💪', 'Celia 🍀', 'Pilar 🌹'];
const CAMPAIGNS = [['cmp_1001', 'Black Friday 2025'], ['cmp_1002', 'Navidad 2025'], ['cmp_1003', 'Rebajas enero'], ['cmp_1004', 'Novedades primavera'], ['cmp_1005', 'Día del padre']] as const;
const NOTES = ['Prefiere visita por la tarde', 'Pedido habitual los lunes', 'Cliente de la zona norte', 'Pide factura a nombre de la empresa', 'Recoge en almacén', 'Revisar condiciones de pago'];
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

const used = new Set<string>();
function unique(make: () => string): string {
  for (;;) {
    const v = make();
    if (!used.has(v)) {
      used.add(v);
      return v;
    }
  }
}

/** Móvil español válido (9 dígitos) según libphonenumber, sin repetir. */
function esMobile(): string {
  return unique(() => {
    for (;;) {
      const n = `${pick(['6', '6', '6', '7'])}${digits(8)}`;
      const r = normalizePhone(n);
      if (r.ok && r.country === 'ES' && r.isMobile && !r.warning) return n;
    }
  });
}
/** Fijo español válido y clasificado como fijo (aviso LANDLINE). */
function esLandline(): string {
  return unique(() => {
    for (;;) {
      const n = `${pick(['91', '93', '94', '95', '96', '96', '97', '98'])}${digits(7)}`;
      const r = normalizePhone(n);
      if (r.ok && r.warning === 'LANDLINE') return n;
    }
  });
}
function foreign(): string {
  return unique(() => {
    for (;;) {
      const [cc, body] = pick([['33', `6${digits(8)}`], ['351', `9${digits(8)}`], ['49', `15${digits(9)}`], ['44', `7${digits(9)}`], ['39', `3${digits(9)}`], ['212', `6${digits(8)}`]] as const);
      const r = normalizePhone(`+${cc}${body}`);
      if (r.ok && r.warning === 'FOREIGN') return `+${cc}${body}`;
    }
  });
}
/** Notación científica de Excel: 965123456 → «9.65123456E8» (sin ceros finales). */
function scientific(n: string): string {
  const mant = (n[0] + '.' + n.slice(1)).replace(/0+$/, '').replace(/\.$/, '.0');
  return `${mant}E${n.length - 1}`;
}

type Kind = 'normal' | 'noPhone' | 'landline' | 'plusNine' | 'plusEight' | 'foreign';
const kinds: Kind[] = [
  ...Array<Kind>(EXPECTED.noPhone).fill('noPhone'),
  ...Array<Kind>(EXPECTED.landlineInPhone).fill('landline'),
  ...Array<Kind>(EXPECTED.plusNine).fill('plusNine'),
  ...Array<Kind>(EXPECTED.plusEight).fill('plusEight'),
  ...Array<Kind>(EXPECTED.foreign).fill('foreign'),
];
while (kinds.length < EXPECTED.total) kinds.push('normal');
shuffle(kinds);

const codes = shuffle(Array.from({ length: 9000 }, (_, i) => String(1000 + i)));
let codeIx = 0;
const sciIdx = new Set(shuffle(Array.from({ length: EXPECTED.total }, (_, i) => i)).slice(0, EXPECTED.landlineScientific));
const sciIncomplete = new Set([...sciIdx].slice(0, EXPECTED.landlineScientificIncomplete));
const plainLandlineIdx = new Set(shuffle(Array.from({ length: EXPECTED.total }, (_, i) => i)).slice(0, 1800));
const emojiIdx = new Set(shuffle(Array.from({ length: EXPECTED.total }, (_, i) => i)).slice(0, EXPECTED.emojiNames));
// Etiquetas: 3 NO PUBLICIDAD y 62 TRANSPORTE entre los contactos con WhatsApp normales
const normalIdx = kinds.map((k, i) => (k === 'normal' ? i : -1)).filter((i) => i >= 0);
shuffle(normalIdx);
const optOutIdx = new Set(normalIdx.slice(0, EXPECTED.optOut));
const transporteIdx = new Set(normalIdx.slice(EXPECTED.optOut, EXPECTED.optOut + EXPECTED.transporte));

export type Row = Record<(typeof HEADERS)[number], string>;

function taxId(): string {
  const r = rnd();
  if (r < 0.4) {
    const n = digits(8);
    return n + DNI_LETTERS[Number(n) % 23];
  }
  if (r < 0.55) return `${pick(['X', 'Y', 'Z'])}${digits(7)}${pick([...DNI_LETTERS])}`;
  if (r < 0.8) return `${pick(['B', 'A', 'G', 'F'])}${digits(8)}`;
  if (r < 0.92) return '-';
  return '';
}

function date(): string {
  return `2025-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')} ${String(int(8, 20)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}`;
}

export function buildRows(): Row[] {
  return kinds.map((kind, i) => {
    const first = emojiIdx.has(i) ? pick(EMOJI_NAMES) : pick(FIRST);
    const last = rnd() < 0.06 ? '' : `${pick(LAST)} ${pick(LAST)}`;
    let phone = '';
    if (kind === 'normal') phone = `+34${esMobile()}`;
    else if (kind === 'landline') phone = rnd() < 0.5 ? esLandline() : `+34${esLandline()}`;
    else if (kind === 'plusNine') phone = `+${esMobile()}`;
    else if (kind === 'plusEight') phone = `+${unique(() => `6${digits(7)}`)}`;
    else if (kind === 'foreign') phone = foreign();
    const needsIdentity = kind === 'noPhone' || kind === 'plusEight';
    const email = needsIdentity || rnd() < 0.55
      ? `${first.replace(/[^\p{L}]/gu, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() || 'cliente'}.${i + 1}@ejemplo.test`
      : '';
    const code = needsIdentity || rnd() < 0.85 ? codes[codeIx++]! : '';
    let landline = '';
    if (sciIdx.has(i)) landline = sciIncomplete.has(i) ? `9.${digits(5)}E7` : scientific(esLandline());
    else if (plainLandlineIdx.has(i)) landline = esLandline();
    const campaigns = rnd() < 0.3 ? CAMPAIGNS.slice(0, int(1, 3)) : [];
    const labels = optOutIdx.has(i) ? 'NO PUBLICIDAD' : transporteIdx.has(i) ? (rnd() < 0.2 ? 'TRANSPORTE, VIP' : 'TRANSPORTE') : '';
    return {
      'ID': `ctc_${String(100000 + i * 7)}`,
      'Nombre': first,
      'Apellido': last,
      'Teléfono': phone,
      'Dirección de correo electrónico': email,
      'Etiquetas': labels,
      'Código': code,
      'DNI': taxId(),
      'Teléfono Fijo': landline,
      'Género': rnd() < 0.1 ? '' : pick(['Weiblich', 'Männlich']),
      'Último mensaje enviado en': rnd() < 0.5 ? date() : '',
      'Último mensaje recibido en': rnd() < 0.3 ? date() : '',
      'IDs de campaña': campaigns.map((c) => c[0]).join(', '),
      'Nombres de campañas': campaigns.map((c) => c[1]).join(', '),
      'Campaña recibida en': campaigns.length ? date() : '',
      'Notas': rnd() < 0.05 ? pick(NOTES) : '',
    };
  });
}

export function toCsv(rows: Row[]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [HEADERS.map(cell).join(','), ...rows.map((r) => HEADERS.map((h) => cell(r[h])).join(','))].join('\n') + '\n';
}

/** Lista de Superchat (Peluquería): 35 contactos del export (3 de baja, 2 sin teléfono) y 5 nuevos; actualiza las notas. */
export function buildListRows(all: Row[]): Row[] {
  const withPhone = all.filter((r) => /^\+34[67]\d{8}$/.test(r['Teléfono']) && !r['Etiquetas']);
  const bajas = all.filter((r) => r['Etiquetas'] === 'NO PUBLICIDAD');
  const noPhone = all.filter((r) => !r['Teléfono'] && r['Dirección de correo electrónico']);
  const pickRows = [...bajas, ...noPhone.slice(0, 2), ...withPhone.slice(0, 30)].map((r) => ({ ...r, 'Etiquetas': '', 'Notas': 'Lista Peluquería: datos actualizados' }));
  const nuevos: Row[] = Array.from({ length: 5 }, (_, k) => ({
    ...Object.fromEntries(HEADERS.map((h) => [h, ''])) as Row,
    'ID': `ctc_9${k}`, 'Nombre': ['Valeria', 'Hugo', 'Inés', 'Mateo', 'Julia'][k]!, 'Apellido': 'Lista Nueva',
    'Teléfono': `+34${esMobile()}`, 'Dirección de correo electrónico': `nuevo.${k + 1}@ejemplo.test`, 'Código': codes[codeIx++]!, 'Género': 'Weiblich',
  }));
  return [...pickRows, ...nuevos];
}

// Solo al ejecutarlo con tsx (no al importarlo desde las pruebas)
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const dir = __dirname;
  const rows = buildRows();
  writeFileSync(join(dir, 'superchat-export-sintetico.csv'), toCsv(rows));
  const list = buildListRows(rows);
  writeFileSync(join(dir, 'superchat-lista-peluqueria-sintetico.csv'), toCsv(list));
  console.log(`Export: ${rows.length} filas · lista: ${list.length} filas`);
}

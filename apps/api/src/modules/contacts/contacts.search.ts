import { Prisma } from '@prisma/client';

/** Clases de caracteres para buscar sin tildes ni mayúsculas (se aplican con ~*, que usa los índices trigram). */
const CLASSES: Record<string, string> = {
  a: 'aàáâäãAÀÁÂÄÃ', e: 'eèéêëEÈÉÊË', i: 'iìíîïIÌÍÎÏ', o: 'oòóôöõOÒÓÔÖÕ', u: 'uùúûüUÙÚÛÜ', n: 'nñNÑ', c: 'cçCÇ',
};

export function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Token → expresión regular de Postgres insensible a tildes y mayúsculas. */
export function tokenRegex(token: string): string {
  let out = '';
  for (const ch of foldAccents(token)) {
    if (CLASSES[ch]) out += `[${CLASSES[ch]}]`;
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += '\\' + ch; // cualquier otro símbolo, literal
  }
  return out;
}

const SEARCH_COLUMNS = ['firstName', 'lastName', 'profileName', 'company', 'phoneE164', 'customerCode', 'taxId', 'landline', 'email'];

/** Fragmento SQL (sin WHERE) con la condición de búsqueda para la tabla "Contact". */
export function searchCondition(q: string): Prisma.Sql | null {
  const tokens = q.split(/\s+/).map((t) => t.trim()).filter(Boolean).slice(0, 8);
  if (!tokens.length) return null;
  const perToken = tokens.map((t) => {
    const re = tokenRegex(t);
    return Prisma.sql`(${Prisma.join(SEARCH_COLUMNS.map((c) => Prisma.sql`${Prisma.raw(`"${c}"`)} ~* ${re}`), ' OR ')})`;
  });
  let cond = Prisma.sql`(${Prisma.join(perToken, ' AND ')})`;
  // «617 49 82 22», «+34 617…»: también se compara solo con los dígitos
  if (/^[\d\s+().-]{3,}$/.test(q)) {
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 3) {
      const like = `%${digits}%`;
      cond = Prisma.sql`(${cond} OR regexp_replace("phoneE164", '\\D', '', 'g') LIKE ${like} OR regexp_replace(coalesce("landline", ''), '\\D', '', 'g') LIKE ${like})`;
    }
  }
  return cond;
}

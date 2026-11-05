/** Quita el carácter NUL de los textos del JSON (PostgreSQL no lo admite en text ni en jsonb y daría 500). */
export function stripNul(_key: string, value: unknown) {
  return typeof value === 'string' && value.includes('\u0000') ? value.replace(/\u0000/g, '') : value;
}

import { describe, expect, it } from 'vitest';
import { safeFrom } from './LoginPage';

describe('safeFrom (redirección tras login)', () => {
  it('acepta rutas internas', () => expect(safeFrom('/contactos/1')).toBe('/contactos/1'));
  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/x:y', undefined, 5])('rechaza %s', (v) =>
    expect(safeFrom(v)).toBe('/bandeja'),
  );
});

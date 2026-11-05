import { describe, it, expect } from 'vitest';
import { fmtRemaining, initials, fmtPct } from './format';

describe('format', () => {
  it('iniciales', () => expect(initials('María Iborra')).toBe('MI'));
  it('porcentaje', () => expect(fmtPct(1, 4)).toBe('25 %'));
  it('tiempo restante', () => expect(fmtRemaining(new Date(Date.now() + 22.5 * 3600e3).toISOString())).toBe('22 h'));
});

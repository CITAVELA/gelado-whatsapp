import { describe, it, expect } from 'vitest';
import { fmtRemaining, initials, fmtPct } from './format';

describe('format', () => {
  it('iniciales', () => expect(initials('María Iborra')).toBe('MI'));
  it('porcentaje', () => expect(fmtPct(1, 4)).toBe('25 %'));
  it('tiempo restante', () => expect(fmtRemaining(new Date(Date.now() + 22.5 * 3600e3).toISOString())).toBe('22 h'));
});

import { fmtBytes, fmtLanguage, fmtNameStatus } from './format';
describe('format · QA F-13, F-14, F-15', () => {
  it('idioma de plantilla en español', () => {
    expect(fmtLanguage('es')).toBe('Español');
    expect(fmtLanguage('ca')).toBe('Catalán');
    expect(fmtLanguage('en_US')).toBe('Inglés');
    expect(fmtLanguage('xx')).toBe('xx');
  });
  it('estado del nombre verificado sin palabras en inglés', () => {
    expect(fmtNameStatus('APPROVED')).toBe('aprobado');
    expect(fmtNameStatus('PENDING_REVIEW')).toBe('pendiente de revisión');
    expect(fmtNameStatus('ALGO_NUEVO')).not.toMatch(/[A-Z_]{4}/);
    expect(fmtNameStatus(null)).toBe('');
  });
  it('tamaños con coma decimal', () => {
    expect(fmtBytes(5.5 * 1024 * 1024)).toBe('5,5 MB');
    expect(fmtBytes(2048)).toBe('2 KB');
  });
});

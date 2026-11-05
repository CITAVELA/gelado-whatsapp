import { describe, expect, it } from 'vitest';
import { normalizeLandline, normalizePhone, waIdToE164 } from '@gelado/shared';
import { suggestMapping } from '../src/modules/contacts/import.parser';
import { analyzeRows } from '../src/modules/contacts/import.rules';

describe('S12 · normalizePhone (reglas de Superchat)', () => {
  it('«+» + 9 dígitos de móvil español → +34… (antes Nueva Caledonia, Tokelau…)', () => {
    for (const [input, e164] of [['+617498222', '+34617498222'], ['+ 617 49 82 22', '+34617498222'], ['+712345678', '+34712345678'], ['+629731421', '+34629731421']] as const) {
      const n = normalizePhone(input);
      expect(n, input).toMatchObject({ ok: true, e164, waId: e164.slice(1), country: 'ES', correctedFromPlus: true });
      expect((n as any).warning).toBeUndefined();
    }
  });
  it('«+» + 8 dígitos que empiezan por 6–9 → «Teléfono español incompleto»', () => {
    for (const input of ['+61749822', '+71234567', '+81234567', '+91234567']) {
      expect(normalizePhone(input), input).toEqual({ ok: false, reason: 'Teléfono español incompleto', code: 'INCOMPLETE_ES' });
    }
    expect(normalizePhone('+5123456')).toMatchObject({ ok: false, code: 'INVALID' });
  });
  it('un número con prefijo +34, 0034 o sin prefijo sigue igual y no lleva aviso', () => {
    for (const input of ['617498222', '+34617498222', '0034617498222', '34617498222', '(34) 617-498-222']) {
      expect(normalizePhone(input), input).toMatchObject({ ok: true, e164: '+34617498222', isMobile: true });
      expect((normalizePhone(input) as any).warning).toBeUndefined();
      expect((normalizePhone(input) as any).correctedFromPlus).toBeUndefined();
    }
  });
  it('avisos: extranjero válido → FOREIGN; fijo español → LANDLINE', () => {
    expect(normalizePhone('+33 6 12 34 56 78')).toMatchObject({ ok: true, e164: '+33612345678', warning: 'FOREIGN' });
    expect(normalizePhone('+351912345678')).toMatchObject({ ok: true, warning: 'FOREIGN' });
    expect(normalizePhone('965123456')).toMatchObject({ ok: true, e164: '+34965123456', warning: 'LANDLINE' });
    expect(normalizePhone('+34 931 234 567')).toMatchObject({ ok: true, warning: 'LANDLINE' });
  });
  it('un fijo de 9 dígitos con «+» (+965123456) también se corrige a +34 con aviso de fijo', () => {
    expect(normalizePhone('+965123456')).toMatchObject({ ok: true, e164: '+34965123456', correctedFromPlus: true, warning: 'LANDLINE' });
  });
  it('el wa_id de Meta no usa la heurística de Superchat', () => {
    expect(waIdToE164('34617498222')).toBe('+34617498222');
    expect(waIdToE164('33612345678')).toBe('+33612345678');
    // sin la heurística, «+687368304» sale como Nueva Caledonia
    expect(normalizePhone('+687368304', 'ES', { superchatPlus: false })).toMatchObject({ ok: true, country: 'NC' });
  });
  it('otros países por defecto no aplican la heurística', () => {
    expect(normalizePhone('+687368304', 'FR')).toMatchObject({ ok: true, country: 'NC' });
  });
});

describe('S12 · fijo en notación científica', () => {
  it('9.65123456E8 → 965123456 (también con coma y +)', () => {
    expect(normalizeLandline('9.65123456E8')).toEqual({ value: '965123456', fixedFromScientific: true });
    expect(normalizeLandline('9,65123456e8')).toEqual({ value: '965123456', fixedFromScientific: true });
    expect(normalizeLandline('9.0E8')).toEqual({ value: '900000000', fixedFromScientific: true });
    expect(normalizeLandline('9.6512E8')).toEqual({ value: '965120000', fixedFromScientific: true });
  });
  it('si no queda completo, se deja tal cual con aviso', () => {
    expect(normalizeLandline('9.65123E7')).toEqual({ value: '9.65123E7', incomplete: true });
    expect(normalizeLandline('9.65123456E9')).toEqual({ value: '9.65123456E9', incomplete: true });
  });
  it('un fijo normal no se toca', () => {
    expect(normalizeLandline('  965 12 34 56 ')).toEqual({ value: '965 12 34 56' });
    expect(normalizeLandline('')).toEqual({ value: null });
    expect(normalizeLandline(null)).toEqual({ value: null });
  });
});

describe('S12 · análisis de filas', () => {
  const opts = (columns: string[]) => ({ mapping: suggestMapping(columns), defaultCountry: 'ES', onDuplicate: 'update' as const, optOutLabelValues: ['NO PUBLICIDAD'] });
  it('avisos con su tipo y sin teléfono con original en notas', () => {
    const cols = ['Nombre', 'Teléfono', 'Dirección de correo electrónico', 'Código', 'Teléfono Fijo'];
    const rows = [
      { Nombre: 'A', 'Teléfono': '+617498222', 'Dirección de correo electrónico': '', 'Código': '', 'Teléfono Fijo': '9.65123456E8' },
      { Nombre: 'B', 'Teléfono': '+61749822', 'Dirección de correo electrónico': 'b@e.test', 'Código': '', 'Teléfono Fijo': '' },
      { Nombre: 'C', 'Teléfono': '968123456', 'Dirección de correo electrónico': '', 'Código': '', 'Teléfono Fijo': '' },
      { Nombre: 'D', 'Teléfono': '+33612345678', 'Dirección de correo electrónico': '', 'Código': '', 'Teléfono Fijo': '' },
      { Nombre: 'E', 'Teléfono': '', 'Dirección de correo electrónico': '', 'Código': '12', 'Teléfono Fijo': '9.1E7' },
    ];
    const a = analyzeRows(rows, opts(cols));
    const byCode = a.issues.map((i) => `${i.row}:${i.code}`);
    expect(byCode).toEqual(['2:PHONE_CORRECTED', '3:PHONE_INCOMPLETE', '4:LANDLINE', '5:FOREIGN', '6:NO_WHATSAPP', '6:LANDLINE_INCOMPLETE']);
    expect(a.plans.map((p) => p.phoneE164)).toEqual(['+34617498222', null, '+34968123456', '+33612345678', null]);
    expect(a.plans[0]!.data.landline).toBe('965123456');
    expect(a.plans[1]!.data.notes).toBe('Teléfono original: +61749822');
    expect(a.withoutWhatsapp).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { businessHoursSchema } from './settings';

const days = (mon: { from: string; to: string }[]) => ({ mon, tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });
const msg = (r: ReturnType<typeof businessHoursSchema.safeParse>) => (r.success ? '' : r.error.issues.map((i) => i.message).join(' | '));

describe('business_hours · F-8 y F-9', () => {
  it('acepta un horario válido, incluso con tramos pegados', () => {
    expect(businessHoursSchema.safeParse({ timezone: 'Europe/Madrid', days: days([{ from: '09:00', to: '13:00' }, { from: '13:00', to: '18:00' }]) }).success).toBe(true);
  });
  it('rechaza una zona horaria que no existe, en español', () => {
    const r = businessHoursSchema.safeParse({ timezone: 'Marte/Olimpo', days: days([]) });
    expect(r.success).toBe(false);
    expect(msg(r)).toMatch(/zona horaria no existe/);
  });
  it('rechaza «hasta» anterior o igual a «desde»', () => {
    expect(msg(businessHoursSchema.safeParse({ timezone: 'Europe/Madrid', days: days([{ from: '14:00', to: '09:00' }]) }))).toMatch(/lunes.*posterior/);
    expect(businessHoursSchema.safeParse({ timezone: 'Europe/Madrid', days: days([{ from: '09:00', to: '09:00' }]) }).success).toBe(false);
  });
  it('rechaza tramos solapados, aunque vengan desordenados', () => {
    expect(msg(businessHoursSchema.safeParse({ timezone: 'Europe/Madrid', days: days([{ from: '13:00', to: '18:00' }, { from: '09:00', to: '14:00' }]) }))).toMatch(/solapan/);
  });
});

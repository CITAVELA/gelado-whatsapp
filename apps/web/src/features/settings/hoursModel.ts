import { WEEKDAYS, hhmmToMinutes, type BusinessHours, type OutOfHours, type Vacation } from '@gelado/shared';

/** Valida el horario: cada tramo con «desde» < «hasta» y sin solaparse. Devuelve el error por día. */
export function validateHours(bh: BusinessHours): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const d of WEEKDAYS) {
    const r = bh.days[d] ?? [];
    for (const t of r) {
      if (!t.from || !t.to) { errors[d] = 'Rellena las dos horas del tramo'; break; }
      if (hhmmToMinutes(t.from) >= hhmmToMinutes(t.to)) { errors[d] = 'La hora de inicio debe ser anterior a la de fin'; break; }
    }
    if (!errors[d] && r.length === 2) {
      const [a, b] = [...r].sort((x, y) => hhmmToMinutes(x.from) - hhmmToMinutes(y.from)) as [typeof r[0], typeof r[0]];
      if (hhmmToMinutes(a!.to) > hhmmToMinutes(b!.from)) errors[d] = 'Los dos tramos se solapan';
    }
  }
  return errors;
}

/** Errores de la respuesta fuera de horario (texto y botones de hasta 20 caracteres). */
export function validateOutOfHours(o: OutOfHours): string[] {
  const out: string[] = [];
  if (!o.text.trim()) out.push('Escribe el texto de la respuesta');
  if (o.text.length > 1024) out.push('El texto supera los 1.024 caracteres');
  if (o.buttons.length > 3) out.push('Máximo 3 botones');
  o.buttons.forEach((b, i) => {
    if (!b.title.trim()) out.push(`El botón ${i + 1} no tiene texto`);
    if (b.title.length > 20) out.push(`El botón ${i + 1} supera los 20 caracteres`);
  });
  return out;
}

export function validateVacation(v: Vacation): string[] {
  const out: string[] = [];
  if (v.enabled && (!v.from || !v.to)) out.push('Indica las fechas de vacaciones (desde y hasta)');
  if (v.from && v.to && v.from > v.to) out.push('La fecha de inicio de vacaciones es posterior a la de fin');
  if (v.enabled && !v.text.trim()) out.push('Escribe el mensaje de vacaciones');
  return out;
}

/** Siguiente id de botón libre («OOH_1», «OOH_2»…). */
export function newButtonId(o: OutOfHours) {
  let n = 1;
  while (o.buttons.some((b) => b.id === `OOH_${n}`)) n++;
  return `OOH_${n}`;
}

/** Resumen del horario en una línea para la vista previa («L–V 09:00–14:00 y 17:00–20:00 · S …»). */
export function summarizeHours(bh: BusinessHours): string {
  const key = (d: (typeof WEEKDAYS)[number]) => (bh.days[d] ?? []).map((r) => `${r.from}–${r.to}`).join(' y ') || 'cerrado';
  const short: Record<string, string> = { mon: 'L', tue: 'M', wed: 'X', thu: 'J', fri: 'V', sat: 'S', sun: 'D' };
  const groups: Array<{ days: string[]; v: string }> = [];
  for (const d of WEEKDAYS) {
    const v = key(d);
    const last = groups[groups.length - 1];
    if (last && last.v === v) last.days.push(short[d]!);
    else groups.push({ days: [short[d]!], v });
  }
  return groups.filter((g) => g.v !== 'cerrado').map((g) => `${g.days.length > 1 ? `${g.days[0]}–${g.days[g.days.length - 1]}` : g.days[0]} ${g.v}`).join(' · ');
}

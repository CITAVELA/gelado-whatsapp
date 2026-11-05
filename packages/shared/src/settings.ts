import { z } from 'zod';
import { WEEKDAYS, zonedParts, hhmmToMinutes, APP_TZ, type Weekday } from './time';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:mm');

export const timeRangeSchema = z.object({ from: hhmm, to: hhmm });
export type TimeRange = z.infer<typeof timeRangeSchema>;

/** ¿Es una zona horaria IANA que el motor conoce? */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('es-ES', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const DAY_LABEL: Record<Weekday, string> = { mon: 'el lunes', tue: 'el martes', wed: 'el miércoles', thu: 'el jueves', fri: 'el viernes', sat: 'el sábado', sun: 'el domingo' };

/** Ajuste `business_hours`: hasta dos tramos por día; [] = cerrado. Zona válida, «desde» < «hasta» y tramos sin solaparse. */
export const businessHoursSchema = z
  .object({
    timezone: z.string().default(APP_TZ).refine(isValidTimeZone, 'La zona horaria no existe (por ejemplo, Europe/Madrid)'),
    days: z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, z.array(timeRangeSchema).max(2, 'Máximo dos tramos por día')])) as Record<Weekday, z.ZodArray<typeof timeRangeSchema>>),
  })
  .superRefine((bh, ctx) => {
    for (const d of WEEKDAYS) {
      const ranges = bh.days[d];
      if (ranges.some((r) => hhmmToMinutes(r.from) >= hhmmToMinutes(r.to))) {
        ctx.addIssue({ code: 'custom', path: ['days', d], message: `Revisa ${DAY_LABEL[d]}: la hora de cierre tiene que ser posterior a la de apertura` });
        continue;
      }
      const sorted = [...ranges].sort((a, b) => hhmmToMinutes(a.from) - hhmmToMinutes(b.from));
      for (let i = 1; i < sorted.length; i++) {
        if (hhmmToMinutes(sorted[i]!.from) < hhmmToMinutes(sorted[i - 1]!.to)) {
          ctx.addIssue({ code: 'custom', path: ['days', d], message: `Revisa ${DAY_LABEL[d]}: los dos tramos se solapan` });
          break;
        }
      }
    }
  });
export type BusinessHours = z.infer<typeof businessHoursSchema>;

export const autoReplyButtonSchema = z.object({
  id: z.string().min(1).max(256),
  title: z.string().min(1).max(20, 'Máximo 20 caracteres (límite de WhatsApp)'),
  /** etiqueta de conversación a proponer al pulsar (PEDIDO, FACTURA…) */
  labelName: z.string().optional(),
});

/** Ajuste `out_of_hours` */
export const outOfHoursSchema = z.object({
  enabled: z.boolean(),
  text: z.string().min(1).max(1024),
  buttons: z.array(autoReplyButtonSchema).max(3),
  minHoursBetween: z.number().int().min(1).default(12),
});
export type OutOfHours = z.infer<typeof outOfHoursSchema>;

/** Ajuste `vacation` */
export const vacationSchema = z.object({
  enabled: z.boolean(),
  from: z.string().nullable(),   // YYYY-MM-DD (Madrid)
  to: z.string().nullable(),     // YYYY-MM-DD inclusive
  text: z.string().max(1024),
});
export type Vacation = z.infer<typeof vacationSchema>;

/** Ajuste `rates` (EUR por mensaje entregado facturable) */
export const ratesSchema = z.object({
  currency: z.string().default('EUR'),
  marketing: z.number().nonnegative(),
  utility: z.number().nonnegative(),
  authentication: z.number().nonnegative(),
  service: z.number().nonnegative(),
  freeServicePerMonth: z.number().int().nonnegative().default(1000),
});
export type Rates = z.infer<typeof ratesSchema>;

/** Ajuste `campaign_defaults` */
export const campaignDefaultsSchema = z.object({
  ratePerMinute: z.number().int().min(1).max(600),
  dailyLimit: z.number().int().min(1),
  requireOptOutButton: z.boolean().default(true),
});
export type CampaignDefaults = z.infer<typeof campaignDefaultsSchema>;

/** Ajuste `privacy_policy` */
export const privacyPolicySchema = z.object({ markdown: z.string(), updatedAt: z.string() });
export type PrivacyPolicy = z.infer<typeof privacyPolicySchema>;

export const SETTING_KEYS = ['business_hours', 'out_of_hours', 'vacation', 'rates', 'campaign_defaults', 'privacy_policy'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const settingSchemas = {
  business_hours: businessHoursSchema,
  out_of_hours: outOfHoursSchema,
  vacation: vacationSchema,
  rates: ratesSchema,
  campaign_defaults: campaignDefaultsSchema,
  privacy_policy: privacyPolicySchema,
} satisfies Record<SettingKey, z.ZodTypeAny>;

/** ¿Está `date` dentro del horario de atención? (zona del ajuste; maneja cambio de hora) */
export function isWithinBusinessHours(date: Date, bh: BusinessHours): boolean {
  const p = zonedParts(date, bh.timezone || APP_TZ);
  const ranges = bh.days[p.weekday] ?? [];
  return ranges.some((r) => p.minutes >= hhmmToMinutes(r.from) && p.minutes < hhmmToMinutes(r.to));
}

/** ¿Está `date` dentro del periodo de vacaciones (fechas inclusivas, Madrid)? */
export function isInVacation(date: Date, v: Vacation, tz = APP_TZ): boolean {
  if (!v.enabled || !v.from || !v.to) return false;
  const ymd = zonedParts(date, tz).ymd;
  return ymd >= v.from && ymd <= v.to;
}

export const DEFAULT_SETTINGS = {
  business_hours: {
    timezone: APP_TZ,
    days: {
      mon: [{ from: '09:00', to: '14:00' }, { from: '17:00', to: '20:00' }],
      tue: [{ from: '09:00', to: '14:00' }, { from: '17:00', to: '20:00' }],
      wed: [{ from: '09:00', to: '14:00' }, { from: '17:00', to: '20:00' }],
      thu: [{ from: '09:00', to: '14:00' }, { from: '17:00', to: '20:00' }],
      fri: [{ from: '09:00', to: '14:00' }, { from: '17:00', to: '20:00' }],
      sat: [{ from: '09:30', to: '13:30' }],
      sun: [],
    },
  } satisfies BusinessHours,
  out_of_hours: {
    enabled: true,
    text:
      'Hola 👋 Gracias por escribir a *Exclusivas Gelado*. Ahora mismo estamos fuera de nuestro horario de atención ' +
      '(L–V 09:00–14:00 y 17:00–20:00 · S 09:30–13:30). Te responderemos en cuanto volvamos. ¿En qué podemos ayudarte?',
    buttons: [
      { id: 'OOH_PEDIDO', title: 'Hacer un pedido', labelName: 'PEDIDO' },
      { id: 'OOH_FACTURA', title: 'Necesito factura', labelName: 'FACTURA' },
      { id: 'OOH_CONSULTA', title: 'Duda o consulta' },
    ],
    minHoursBetween: 12,
  } satisfies OutOfHours,
  vacation: {
    enabled: false,
    from: null,
    to: null,
    text: 'Hola 👋 Estamos de vacaciones y volvemos el [fecha]. Te responderemos a la vuelta. ¡Gracias por tu paciencia!',
  } satisfies Vacation,
  rates: {
    currency: 'EUR',
    marketing: 0.0585,
    utility: 0.0166,
    authentication: 0.0166,
    service: 0.0166,
    freeServicePerMonth: 1000,
  } satisfies Rates,
  campaign_defaults: { ratePerMinute: 20, dailyLimit: 2000, requireOptOutButton: true } satisfies CampaignDefaults,
};

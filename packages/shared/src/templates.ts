import { z } from 'zod';
import type { TemplateCategory, TemplateStatus } from './enums';

/** Componentes tal cual Meta (HEADER/BODY/FOOTER/BUTTONS). */
export interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
  text?: string;
  example?: { header_text?: string[]; body_text?: string[][]; header_handle?: string[] };
  buttons?: TemplateButton[];
}
export interface TemplateButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE' | 'FLOW';
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[];
}

export interface TemplateDto {
  id: string;
  metaTemplateId: string | null;
  name: string;
  displayName: string | null;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  components: TemplateComponent[];
  rejectedReason: string | null;
  qualityScore: string | null;
  hasOptOutButton: boolean;
  /** variables necesarias para enviar: ["header.1", "body.1", "body.2", "button.1"] */
  variables: string[];
  headerFormat: 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
  usableInCampaigns: boolean;
  lastSyncedAt: string | null;
  updatedAt: string;
}

export const META_TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
export const TEMPLATE_LIMITS = { footer: 60, quickReply: 25, buttonText: 25, body: 1024, headerText: 60, maxButtons: 10 };

export const templateEditorSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  name: z.string().regex(META_TEMPLATE_NAME_RE, 'Solo minúsculas, números y _'),
  category: z.enum(['MARKETING', 'UTILITY']),
  language: z.string().min(2).max(10).default('es'),
  header: z
    .object({
      format: z.enum(['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT']),
      text: z.string().max(60).optional(),
      textExample: z.string().optional(),
      exampleMediaFileId: z.string().uuid().optional(),
    })
    .default({ format: 'NONE' }),
  body: z.string().trim().min(1).max(1024),
  bodyExamples: z.array(z.string().min(1, 'Ejemplo obligatorio')).default([]),
  footer: z.string().max(60).optional(),
  buttons: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('QUICK_REPLY'), text: z.string().min(1).max(25) }),
        z.object({ type: z.literal('URL'), text: z.string().min(1).max(25), url: z.string().url(), example: z.string().optional() }),
        z.object({ type: z.literal('PHONE_NUMBER'), text: z.string().min(1).max(25), phone: z.string().min(5) }),
      ]),
    )
    .max(10)
    .default([]),
  addOptOutButton: z.boolean().default(true),
});
export type TemplateEditorDto = z.infer<typeof templateEditorSchema>;

/** Variables `{{n}}` de un texto, en orden de aparición. */
export function extractVariables(text: string | undefined | null): number[] {
  if (!text) return [];
  return [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
}

/** Las variables deben ser 1..n consecutivas. */
export function variablesAreConsecutive(text: string): boolean {
  const vars = [...new Set(extractVariables(text))].sort((a, b) => a - b);
  return vars.every((v, i) => v === i + 1);
}

/** Lista de claves de variable que necesita una plantilla para enviarse. */
export function templateVariableKeys(components: TemplateComponent[]): string[] {
  const keys: string[] = [];
  for (const c of components) {
    if (c.type === 'HEADER' && c.format === 'TEXT') extractVariables(c.text).forEach((n) => keys.push(`header.${n}`));
    if (c.type === 'BODY') [...new Set(extractVariables(c.text))].forEach((n) => keys.push(`body.${n}`));
    if (c.type === 'BUTTONS')
      c.buttons?.forEach((b, i) => {
        if (b.type === 'URL' && b.url && /\{\{\s*1\s*\}\}/.test(b.url)) keys.push(`button.${i}`);
      });
  }
  return keys;
}

/** ¿Tiene la plantilla el botón de respuesta rápida «No recibir más»? */
export function hasOptOutButton(components: TemplateComponent[]): boolean {
  return components.some(
    (c) => c.type === 'BUTTONS' && c.buttons?.some((b) => b.type === 'QUICK_REPLY' && /no recibir m[aá]s|baja|stop/i.test(b.text)),
  );
}

/** Índice del botón de baja (para enviar el payload OPT_OUT). */
export function optOutButtonIndex(components: TemplateComponent[]): number {
  const btns = components.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
  return btns.findIndex((b) => b.type === 'QUICK_REPLY' && /no recibir m[aá]s|baja|stop/i.test(b.text));
}

/** Rellena el texto con los parámetros para la vista previa. */
export function renderTemplateText(text: string | undefined, values: Record<number, string>): string {
  return (text ?? '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => values[Number(n)] ?? `{{${n}}}`);
}

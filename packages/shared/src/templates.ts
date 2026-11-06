import { z } from 'zod';
import type { TemplateCategory, TemplateStatus } from './enums';
import { OPT_OUT_BUTTON_TEXT, isCanonicalOptOutButtonText, isOptOutButtonText } from './optout';

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
  /** Solo en borradores locales (`LOCAL_DRAFT`): el contenido del editor tal cual se guardó. */
  draft?: TemplateDraftDto | null;
  lastSyncedAt: string | null;
  updatedAt: string;
}

export const META_TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
export const TEMPLATE_LIMITS = { footer: 60, quickReply: 25, buttonText: 25, body: 1024, headerText: 60, maxButtons: 10 };

export const templateEditorSchema = z.object({
  displayName: z.string({ required_error: 'Escribe un nombre para la plantilla' }).trim().min(1, 'Escribe un nombre para la plantilla').max(120, 'El nombre es demasiado largo (máximo 120)'),
  name: z
    .string({ required_error: 'Falta el nombre de Meta' })
    .regex(META_TEMPLATE_NAME_RE, 'El nombre en Meta solo admite minúsculas, números y guion bajo (_)'),
  category: z.enum(['MARKETING', 'UTILITY'], { errorMap: () => ({ message: 'Elige la categoría: Marketing o Utilidad' }) }),
  language: z.string().min(2, 'Elige el idioma').max(10).default('es'),
  header: z
    .object({
      format: z.enum(['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT']),
      text: z.string().max(60, 'La cabecera admite 60 caracteres como máximo').optional(),
      textExample: z.string().optional(),
      exampleMediaFileId: z.string().uuid('El archivo de ejemplo no es válido').optional(),
    })
    .default({ format: 'NONE' }),
  body: z.string({ required_error: 'Escribe el mensaje' }).trim().min(1, 'Escribe el mensaje').max(1024, 'El mensaje admite 1024 caracteres como máximo'),
  bodyExamples: z.array(z.string()).default([]),
  footer: z.string().max(60, 'El pie admite 60 caracteres como máximo').optional(),
  buttons: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('QUICK_REPLY'), text: z.string().trim().min(1, 'El botón necesita un texto').max(25, 'El texto del botón admite 25 caracteres como máximo') }),
        z.object({
          type: z.literal('URL'),
          text: z.string().trim().min(1, 'El botón necesita un texto').max(25, 'El texto del botón admite 25 caracteres como máximo'),
          url: z.string().url('La dirección del enlace no es válida (empieza por https://)'),
          example: z.string().optional(),
        }),
        z.object({ type: z.literal('PHONE_NUMBER'), text: z.string().trim().min(1, 'El botón necesita un texto').max(25, 'El texto del botón admite 25 caracteres como máximo'), phone: z.string().min(5, 'El teléfono no es válido') }),
      ]),
    )
    .max(10, 'Máximo 10 botones')
    .default([]),
  addOptOutButton: z.boolean().default(true),
});
export type TemplateEditorDto = z.infer<typeof templateEditorSchema>;
export type TemplateEditorButton = TemplateEditorDto['buttons'][number];

/**
 * Borrador local («Guardar borrador»): validación suave. Solo hace falta el nombre de Meta (ya normalizado) y el
 * idioma; el resto puede estar incompleto y se valida entero al enviar a revisión (`templateEditorSchema` +
 * `validateTemplateEditor`). Los límites de longitud son solo de seguridad.
 */
export const templateDraftSchema = z.object({
  displayName: z.string().trim().max(120, 'El nombre es demasiado largo (máximo 120)').default(''),
  name: z
    .string({ required_error: 'Escribe un nombre para la plantilla' })
    .min(1, 'Escribe un nombre para la plantilla')
    .regex(META_TEMPLATE_NAME_RE, 'El nombre en Meta solo admite minúsculas, números y guion bajo (_)'),
  category: z.enum(['MARKETING', 'UTILITY'], { errorMap: () => ({ message: 'Elige la categoría: Marketing o Utilidad' }) }).default('MARKETING'),
  language: z.string({ required_error: 'Elige el idioma' }).min(2, 'Elige el idioma').max(10).default('es'),
  header: z
    .object({
      format: z.enum(['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT']).default('NONE'),
      text: z.string().max(200).optional(),
      textExample: z.string().max(500).optional(),
      exampleMediaFileId: z.string().uuid('El archivo de ejemplo no es válido').optional(),
    })
    .default({ format: 'NONE' }),
  body: z.string().max(4096, 'El mensaje es demasiado largo').default(''),
  bodyExamples: z.array(z.string().max(500)).max(50).default([]),
  footer: z.string().max(200).optional(),
  buttons: z
    .array(
      z.object({
        type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']),
        text: z.string().max(100).default(''),
        url: z.string().max(2000).optional(),
        example: z.string().max(500).optional(),
        phone: z.string().max(40).optional(),
      }),
    )
    .max(10, 'Máximo 10 botones')
    .default([]),
  addOptOutButton: z.boolean().default(true),
});
export type TemplateDraftDto = z.infer<typeof templateDraftSchema>;

/** Borrador (posiblemente incompleto) → forma del editor, con valores por defecto donde falte algo. */
export function draftToEditor(d: TemplateDraftDto): TemplateEditorDto {
  return {
    displayName: d.displayName ?? '',
    name: d.name,
    category: d.category,
    language: d.language,
    header: d.header,
    body: d.body ?? '',
    bodyExamples: d.bodyExamples ?? [],
    footer: d.footer,
    buttons: (d.buttons ?? [])
      .filter((b) => b.text.trim())
      .map((b) =>
        b.type === 'QUICK_REPLY'
          ? { type: 'QUICK_REPLY' as const, text: b.text }
          : b.type === 'URL'
            ? { type: 'URL' as const, text: b.text, url: b.url ?? '', example: b.example }
            : { type: 'PHONE_NUMBER' as const, text: b.text, phone: b.phone ?? '' },
      ),
    addOptOutButton: d.addOptOutButton,
  };
}

/** `components` aproximados de un borrador (vista previa, variables…); no son los que se mandarían a Meta. */
export function draftToComponents(d: TemplateDraftDto): TemplateComponent[] {
  return editorToComponents(draftToEditor(d));
}

/** Respuesta rápida con exactamente «No recibir más» (la que impone el editor). */
const isCanonicalOptOutQr = (b: { type: string; text: string }) => b.type === 'QUICK_REPLY' && isCanonicalOptOutButtonText(b.text);
/** Respuesta rápida cuyo texto es uno de los de baja admitidos (lista cerrada, coincidencia exacta). */
export const isOptOutQr = (b: { type: string; text: string }) => b.type === 'QUICK_REPLY' && isOptOutButtonText(b.text);

/** Reglas de docs/06 que el esquema zod no cubre. Devuelve los errores en español (vacío = válida). */
export function validateTemplateEditor(dto: TemplateEditorDto): string[] {
  const errs: string[] = [];
  // cuerpo
  const bodyVars = extractVariables(dto.body);
  if (!variablesAreConsecutive(dto.body)) errs.push('Las variables del mensaje deben ser consecutivas: {{1}}, {{2}}, {{3}}…');
  else {
    const n = new Set(bodyVars).size;
    for (let i = 0; i < n; i++) if (!dto.bodyExamples[i]?.trim()) errs.push(`Falta el ejemplo de la variable {{${i + 1}}} del mensaje (Meta lo exige)`);
    if (n > 0 && /^\s*\{\{\s*\d+\s*\}\}/.test(dto.body)) errs.push('El mensaje no puede empezar por una variable: añade antes algún texto');
    if (n > 0 && /\{\{\s*\d+\s*\}\}\s*$/.test(dto.body)) errs.push('El mensaje no puede acabar en una variable: añade después algún texto');
  }
  // cabecera
  const h = dto.header;
  if (h.format === 'TEXT') {
    if (!h.text?.trim()) errs.push('Escribe el texto de la cabecera');
    else {
      if (h.text.length > TEMPLATE_LIMITS.headerText) errs.push(`La cabecera admite ${TEMPLATE_LIMITS.headerText} caracteres como máximo`);
      const hv = [...new Set(extractVariables(h.text))];
      if (hv.length > 1 || (hv.length === 1 && hv[0] !== 1)) errs.push('La cabecera solo admite una variable: {{1}}');
      if (hv.length === 1 && !h.textExample?.trim()) errs.push('Falta el ejemplo de la variable de la cabecera');
    }
  } else if (h.format !== 'NONE' && !h.exampleMediaFileId) {
    errs.push('Sube un archivo de ejemplo para la cabecera (Meta lo exige)');
  }
  // pie
  if (dto.footer) {
    if (dto.footer.length > TEMPLATE_LIMITS.footer) errs.push(`El pie admite ${TEMPLATE_LIMITS.footer} caracteres como máximo`);
    if (extractVariables(dto.footer).length) errs.push('El pie no admite variables');
  }
  // botones
  dto.buttons.forEach((b, i) => {
    const n = i + 1;
    if (b.type === 'QUICK_REPLY' && b.text.length > TEMPLATE_LIMITS.quickReply) errs.push(`El botón ${n} (respuesta rápida) admite ${TEMPLATE_LIMITS.quickReply} caracteres como máximo`);
    if (b.type === 'URL') {
      const m = [...b.url.matchAll(/\{\{\s*(\d+)\s*\}\}/g)];
      if (m.length > 1 || (m.length === 1 && m[0]![1] !== '1')) errs.push(`El enlace del botón ${n} solo admite una variable {{1}}`);
      else if (m.length === 1) {
        if (!/\{\{\s*1\s*\}\}$/.test(b.url)) errs.push(`En el botón ${n}, la variable del enlace solo puede ir al final de la dirección`);
        if (!b.example?.trim()) errs.push(`Falta el ejemplo de la variable del enlace del botón ${n}`);
      }
    }
  });
  if (dto.buttons.filter((b) => b.type === 'URL').length > 2) errs.push('Meta admite como máximo 2 botones de enlace');
  if (dto.buttons.filter((b) => b.type === 'PHONE_NUMBER').length > 1) errs.push('Meta admite como máximo 1 botón de llamada');
  const total = dto.buttons.length + (dto.category === 'MARKETING' && !dto.buttons.some(isCanonicalOptOutQr) ? 1 : 0);
  if (total > TEMPLATE_LIMITS.maxButtons) errs.push(`Máximo ${TEMPLATE_LIMITS.maxButtons} botones (el botón «${OPT_OUT_BUTTON_TEXT}» cuenta)`);
  return errs;
}

/**
 * Construye los `components` con la forma de Meta a partir del editor. Lo usa el servidor (con `headerHandle`
 * del Resumable Upload) y la vista previa del editor. En Marketing impone siempre el botón «No recibir más»
 * (RF-4.5); en Utilidad solo si `addOptOutButton`.
 */
export function editorToComponents(dto: TemplateEditorDto, opts: { headerHandle?: string } = {}): TemplateComponent[] {
  const out: TemplateComponent[] = [];
  const h = dto.header;
  if (h.format === 'TEXT' && h.text?.trim()) {
    const c: TemplateComponent = { type: 'HEADER', format: 'TEXT', text: h.text.trim() };
    if (extractVariables(h.text).length) c.example = { header_text: [h.textExample?.trim() ?? ''] };
    out.push(c);
  } else if (h.format === 'IMAGE' || h.format === 'VIDEO' || h.format === 'DOCUMENT') {
    out.push({ type: 'HEADER', format: h.format, example: { header_handle: [opts.headerHandle ?? ''] } });
  }
  const body: TemplateComponent = { type: 'BODY', text: dto.body.trim() };
  const nVars = new Set(extractVariables(dto.body)).size;
  if (nVars > 0) body.example = { body_text: [Array.from({ length: nVars }, (_, i) => dto.bodyExamples[i]?.trim() ?? '')] };
  out.push(body);
  if (dto.footer?.trim()) out.push({ type: 'FOOTER', text: dto.footer.trim() });

  const quick: TemplateButton[] = [];
  const others: TemplateButton[] = [];
  for (const b of dto.buttons) {
    if (b.type === 'QUICK_REPLY') quick.push({ type: 'QUICK_REPLY', text: b.text.trim() });
    else if (b.type === 'URL') {
      const btn: TemplateButton = { type: 'URL', text: b.text.trim(), url: b.url };
      if (/\{\{\s*1\s*\}\}/.test(b.url)) {
        const ex = b.example?.trim() ?? '';
        btn.example = [/^https?:\/\//i.test(ex) ? ex : b.url.replace(/\{\{\s*1\s*\}\}/, ex)];
      }
      others.push(btn);
    } else others.push({ type: 'PHONE_NUMBER', text: b.text.trim(), phone_number: b.phone.replace(/[\s()-]/g, '') });
  }
  const wantsOptOut = dto.category === 'MARKETING' || dto.addOptOutButton;
  if (wantsOptOut && !quick.some(isCanonicalOptOutQr)) quick.push({ type: 'QUICK_REPLY', text: OPT_OUT_BUTTON_TEXT });
  const buttons = [...quick, ...others];
  if (buttons.length) out.push({ type: 'BUTTONS', buttons });
  return out;
}

/** Nombre de Meta a partir del nombre legible: minúsculas, sin tildes, `_` entre palabras. */
export function slugifyTemplateName(displayName: string): string {
  return displayName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512);
}

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
  return components.some((c) => c.type === 'BUTTONS' && c.buttons?.some(isOptOutQr));
}

/** Índice del botón de baja (para enviar el payload OPT_OUT). */
export function optOutButtonIndex(components: TemplateComponent[]): number {
  const btns = components.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
  const exact = btns.findIndex(isCanonicalOptOutQr);
  return exact >= 0 ? exact : btns.findIndex(isOptOutQr);
}

/** Rellena el texto con los parámetros para la vista previa. */
export function renderTemplateText(text: string | undefined, values: Record<number, string>): string {
  return (text ?? '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => values[Number(n)] ?? `{{${n}}}`);
}

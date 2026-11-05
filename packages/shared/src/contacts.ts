import { z } from 'zod';
import type { ConsentSource, ConsentStatus, RecipientStatus } from './enums';
import type { LabelDto } from './labels';
import { LEGACY_OPT_OUT_LABEL } from './optout';

export interface ContactDto {
  id: string;
  /** null = contacto sin WhatsApp (importado solo con correo y/o código, P16) */
  phoneE164: string | null;
  waId: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;          // nombre + apellidos, o perfil de WhatsApp, empresa, teléfono, correo o código
  profileName: string | null;
  email: string | null;
  company: string | null;
  customerCode: string | null;
  taxId: string | null;
  landline: string | null;
  notes: string | null;
  consentStatus: ConsentStatus;
  consentAt: string | null;
  phoneInvalid: boolean;
  labels: LabelDto[];
  conversationId: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConsentEventDto {
  id: string;
  status: ConsentStatus;
  source: ConsentSource;
  note: string | null;
  userName: string | null;
  createdAt: string;
}

export interface ContactCampaignDto {
  campaignId: string;
  name: string;
  status: RecipientStatus;
  skipReason: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  repliedAt: string | null;
}

export const contactListQuerySchema = z.object({
  q: z.string().trim().optional(),
  includeLabelIds: uuidList('Etiqueta no válida en el filtro'),
  excludeLabelIds: uuidList('Etiqueta no válida en el filtro'),
  consent: z.enum(['UNKNOWN', 'GRANTED', 'REVOKED']).optional(),
  /** with = tiene teléfono (WhatsApp) · without = «Sin WhatsApp» */
  whatsapp: z.enum(['with', 'without']).optional(),
  /** Solo estos contactos (exportar una selección) */
  ids: z.union([z.string(), z.array(z.string())]).optional().transform(toArr),
  phoneInvalid: z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).optional().transform((v) => (v === undefined ? undefined : v === true || v === 'true' || v === '1')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  sort: z.enum(['name', 'createdAt', 'lastActivity']).default('name'),
});
export type ContactListQuery = z.infer<typeof contactListQuerySchema>;

/** Lista de UUID (separados por comas o repetidos); un valor que no sea UUID da 400 con mensaje en español. */
function uuidList(message: string) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform(toArr)
    .pipe(z.array(z.string().uuid(message)).optional());
}

function toArr(v: string | string[] | undefined): string[] | undefined {
  if (v == null) return undefined;
  const a = Array.isArray(v) ? v : v.split(',');
  const r = a.map((s) => s.trim()).filter(Boolean);
  return r.length ? r : undefined;
}

const optStr = (max = 200) => z.string().trim().max(max).nullable().optional().transform((s) => (s === undefined ? undefined : s ? s : null));

export const contactUpsertSchema = z.object({
  /** Opcional si hay correo (el servicio exige teléfono o correo) */
  phone: z.string().trim().nullable().optional(),
  firstName: optStr(),
  lastName: optStr(),
  email: z.string().trim().email('Correo no válido').nullable().optional().or(z.literal('').transform(() => null)),
  company: optStr(),
  customerCode: optStr(60),
  taxId: optStr(30),
  landline: optStr(40),
  notes: optStr(5000),
  labelIds: z.array(z.string().uuid()).optional(),
});
export type ContactUpsertDto = z.infer<typeof contactUpsertSchema>;

export const consentChangeSchema = z.object({
  status: z.enum(['UNKNOWN', 'GRANTED', 'REVOKED']),
  source: z.enum(['MANUAL', 'IMPORT', 'CAMPAIGN_DECLARATION']).default('MANUAL'),
  note: z.string().trim().max(500).optional(),
});
export type ConsentChangeDto = z.infer<typeof consentChangeSchema>;

export const bulkContactsSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(10000),
  action: z.enum(['addLabel', 'removeLabel', 'setConsent']),
  labelId: z.string().uuid().optional(),
  consent: consentChangeSchema.optional(),
});
export type BulkContactsDto = z.infer<typeof bulkContactsSchema>;

// ── Importación ──

export const IMPORT_FIELDS = ['firstName', 'lastName', 'phone', 'email', 'customerCode', 'taxId', 'landline', 'company', 'notes', 'labels', 'ignore'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const IMPORT_FIELD_ES: Record<ImportField, string> = {
  firstName: 'Nombre', lastName: 'Apellidos', phone: 'Teléfono móvil', email: 'Correo', customerCode: 'Código',
  taxId: 'DNI/CIF', landline: 'Teléfono fijo', company: 'Empresa', notes: 'Notas', labels: 'Etiquetas / Listas', ignore: 'No importar',
};

export const importOptionsSchema = z.object({
  mapping: z.record(z.string(), z.enum(IMPORT_FIELDS)),     // columna del archivo → campo
  defaultCountry: z.string().length(2).default('ES'),
  onDuplicate: z.enum(['update', 'skip']).default('update'),
  addLabelIds: z.array(z.string().uuid()).default([]),
  /** Valores de la columna de etiquetas que se tratan como baja (P7) */
  optOutLabelValues: z.array(z.string()).default(['NO PUBLICIDAD']).transform(withMandatoryOptOut),
  initialConsent: z.enum(['UNKNOWN', 'GRANTED']).default('UNKNOWN'),
  createMissingLabels: z.boolean().default(true),
});
export type ImportOptionsDto = z.infer<typeof importOptionsSchema>;

/**
 * P7 (docs/10): NO PUBLICIDAD es SIEMPRE una baja en la importación, lo pida o no el cliente. Devuelve los valores
 * configurados más «NO PUBLICIDAD» (sin duplicados al comparar sin tildes ni mayúsculas).
 */
export function withMandatoryOptOut(values: readonly string[]): string[] {
  const key = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const out = [...values.map((v) => v.trim()).filter(Boolean)];
  if (!out.some((v) => key(v) === key(LEGACY_OPT_OUT_LABEL))) out.push(LEGACY_OPT_OUT_LABEL);
  return out;
}

export interface ImportUploadResultDto {
  jobId: string;
  fileName: string;
  columns: string[];
  suggestedMapping: Record<string, ImportField>;
  sampleRows: Record<string, string>[];
  totalRows: number;
}

/** kind: skipped = fila descartada · merged = duplicada unida a otra del archivo · warning = se importa pero con un aviso */
export interface ImportRowIssue { row: number; reason: string; value?: string; kind?: 'skipped' | 'merged' | 'warning'; code?: ImportIssueCode }

/** Tipo de aviso/incidencia (para contar y filtrar el informe) */
export const IMPORT_ISSUE_CODES = [
  'EMPTY_ROW', 'NO_CONTACT', 'PHONE_INCOMPLETE', 'PHONE_INVALID', 'NO_WHATSAPP', 'FOREIGN', 'LANDLINE', 'PHONE_CORRECTED',
  'LANDLINE_INCOMPLETE', 'EMAIL_INVALID', 'DUPLICATE_FILE', 'EXISTS_SKIPPED', 'LABEL_MISSING', 'OPT_OUT_APPLIED', 'CREATE_FAILED',
] as const;
export type ImportIssueCode = (typeof IMPORT_ISSUE_CODES)[number];
export const IMPORT_ISSUE_CODE_ES: Record<ImportIssueCode, string> = {
  EMPTY_ROW: 'Fila vacía', NO_CONTACT: 'Sin teléfono, correo ni código', PHONE_INCOMPLETE: 'Teléfono español incompleto', PHONE_INVALID: 'Teléfono no válido',
  NO_WHATSAPP: 'Sin WhatsApp', FOREIGN: 'País distinto de España: revisar', LANDLINE: 'Fijo español: probablemente sin WhatsApp',
  PHONE_CORRECTED: 'Teléfono corregido a +34', LANDLINE_INCOMPLETE: 'Teléfono fijo incompleto (se deja tal cual)', EMAIL_INVALID: 'Correo no válido',
  DUPLICATE_FILE: 'Duplicado dentro del archivo', EXISTS_SKIPPED: 'Ya existía (omitido)', LABEL_MISSING: 'Etiqueta inexistente', OPT_OUT_APPLIED: 'Baja aplicada', CREATE_FAILED: 'No se pudo crear',
};

export interface ImportPreviewDto {
  jobId: string;
  totalRows: number;
  willCreate: number;
  willUpdate: number;
  willSkip: number;
  willOptOut: number;
  /** Detalle de lo descartado/unido (willSkip = suma de estos + existentes omitidos) */
  invalidPhone?: number;
  emptyRows?: number;
  duplicatesInFile?: number;
  skippedExisting?: number;
  /** Contactos que se importarán sin teléfono (Sin WhatsApp) */
  withoutWhatsapp?: number;
  /** Incidencias por tipo (avisos incluidos) */
  issuesByCode?: Partial<Record<ImportIssueCode, number>>;
  totalIssues?: number;
  issues: ImportRowIssue[];   // primeras N
  sample: Array<{ row: number; phoneE164: string | null; name: string; labels: string[]; action: 'create' | 'update' | 'skip'; reason?: string }>;
}

export interface ImportJobDto {
  id: string;
  fileName: string;
  status: 'UPLOADED' | 'PREVIEWED' | 'RUNNING' | 'DONE' | 'FAILED';
  totalRows: number;
  processedRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportRowIssue[];
  /** Total de incidencias del informe (errors puede venir recortado) */
  errorCount?: number;
  optedOut?: number;
  labelsCreated?: number;
  withoutWhatsapp?: number;
  issuesByCode?: Partial<Record<ImportIssueCode, number>>;
  failureMessage?: string | null;
  createdAt: string;
  finishedAt: string | null;
}

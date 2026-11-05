import { z } from 'zod';
import type { CampaignStatus, RecipientStatus } from './enums';

/** Mapeo de variables: { "body.1": { field: "firstName", fallback: "cliente" } } o { text: "fijo" } */
export const variableSourceSchema = z.union([
  z.object({ field: z.enum(['firstName', 'lastName', 'displayName', 'company', 'customerCode', 'profileName']), fallback: z.string().default('') }),
  z.object({ text: z.string() }),
]);
export type VariableSource = z.infer<typeof variableSourceSchema>;

export const audienceSchema = z.object({
  includeLabelIds: z.array(z.string().uuid()).default([]),
  excludeLabelIds: z.array(z.string().uuid()).default([]),
  /** true = todos los contactos (si includeLabelIds está vacío) */
  allContacts: z.boolean().default(false),
  contactIds: z.array(z.string().uuid()).optional(),  // selección manual (también excluye REVOKED)
});
export type AudienceDto = z.infer<typeof audienceSchema>;

export const campaignUpsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  templateId: z.string().uuid(),
  variableMapping: z.record(z.string(), variableSourceSchema).default({}),
  headerMediaFileId: z.string().uuid().nullable().optional(),
  audience: audienceSchema,
  scheduledAt: z.string().datetime().nullable().optional(),
  ratePerMinute: z.number().int().min(1).max(600).default(20),
});
export type CampaignUpsertDto = z.infer<typeof campaignUpsertSchema>;

export interface AudienceCountDto {
  selected: number;        // en las etiquetas elegidas
  excludedByLabel: number;
  excludedRevoked: number;
  excludedInvalid: number;
  excludedDuplicate: number;
  willReceive: number;
  dailyLimit: number;
  usedLast24h: number;
  /** reparto por días si supera el límite: [{ day: "2026-11-06", count: 2000 }, …] */
  plan: Array<{ day: string; count: number }>;
  estimatedCost: number;
  estimatedMinutes: number;
}

export interface CampaignDto {
  id: string;
  name: string;
  templateId: string;
  templateName: string;
  variableMapping: Record<string, VariableSource>;
  headerMediaFileId: string | null;
  audience: AudienceDto;
  status: CampaignStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  ratePerMinute: number;
  stopReason: string | null;
  estimatedCost: number | null;
  actualCost: number | null;
  currency: string;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  repliedCount: number;
  failedCount: number;
  skippedCount: number;
  optOutCount: number;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface CampaignRecipientDto {
  id: string;
  contactId: string;
  conversationId: string | null;
  displayName: string;
  phoneE164: string;
  status: RecipientStatus;
  skipReason: string | null;
  plannedFor: string | null;
  errorCode: number | null;
  errorTitle: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  repliedAt: string | null;
  optedOutAt: string | null;
}

export interface CampaignReportDto {
  campaign: CampaignDto;
  funnel: { sent: number; delivered: number; read: number; replied: number };
  failureReasons: Array<{ code: number | null; title: string; count: number }>;
  skipReasons: Array<{ reason: string; count: number }>;
}

export const recipientsQuerySchema = z.object({
  tab: z.enum(['all', 'delivered', 'read', 'replied', 'failed', 'skipped']).default('all'),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

export const testSendSchema = z.object({ phone: z.string().min(3) });

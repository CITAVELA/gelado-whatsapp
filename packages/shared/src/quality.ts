export type QualityRating = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
export type AlertLevel = 'ok' | 'warning' | 'critical';

export interface AlertDto {
  id: string;
  level: Exclude<AlertLevel, 'ok'>;
  kind: 'quality' | 'phone_flagged' | 'template_paused' | 'account' | 'sending_stopped' | 'webhook_stale';
  message: string;      // en español
  link?: string;        // /calidad
  createdAt: string;
}

export interface QualityStatusDto {
  qualityRating: QualityRating;
  phoneStatus: string | null;
  messagingLimit: string | null;
  dailyLimit: number;
  usedLast24h: number;
  displayPhoneNumber: string;
  verifiedName: string | null;
  lastWebhookAt: string | null;
  history: Array<{ qualityRating: QualityRating; messagingLimit: string | null; createdAt: string }>;
}

export interface CostsDto {
  month: string;                 // YYYY-MM
  currency: string;
  total: number;
  byCategory: Record<string, { count: number; cost: number }>;
  byCampaign: Array<{ campaignId: string; name: string; count: number; cost: number }>;
  freeServiceUsed: number;
  freeServiceLimit: number;
}

export interface CampaignComparisonRow {
  campaignId: string; name: string; sentAt: string | null; recipients: number;
  deliveredPct: number; readPct: number; repliedPct: number; optOutPct: number;
}

/** Respuesta de /api/status (protegido con STATUS_TOKEN) para la revisión diaria. */
export interface StatusDto {
  status: AlertLevel;
  checkedAt: string;
  quality: QualityRating;
  phoneStatus: string | null;
  messagingLimit: string | null;
  alerts: AlertDto[];
  lastWebhookAt: string | null;
  pendingWebhookEvents: number;
  failedJobs24h: number;
  runningCampaigns: number;
}

/** Límite diario de destinatarios únicos fuera de la ventana de 24 h según el escalón de Meta. */
export const TIER_LIMITS: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_2K: 2000,
  TIER_10K: 10000,
  TIER_100K: 100000,
  TIER_UNLIMITED: 1000000,
};

/** Límite diario para un escalón; null si el escalón no se conoce. */
export function dailyLimitForTier(tier: string | null | undefined): number | null {
  if (!tier) return null;
  return TIER_LIMITS[tier.toUpperCase()] ?? null;
}

/** GET /api/settings/whatsapp (solo administradora; nunca incluye secretos). */
export interface WhatsAppSettingsDto {
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: QualityRating;
  phoneStatus: string | null;
  messagingLimit: string | null;
  nameStatus: string | null;
  wabaId: string;
  phoneNumberId: string;
  businessId: string;
  graphApiVersion: string;
  lastWebhookAt: string | null;
  pendingWebhookEvents: number;
  failedWebhookEvents: number;
  webhookUrl: string;
}

/** Campos entre corchetes que aún hay que rellenar en la política de privacidad, p. ej. «[CIF]». */
export function privacyPlaceholders(markdown: string): string[] {
  const found = new Set<string>();
  const re = /\[([^\]\n]{2,60})\](?!\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) found.add(`[${m[1]}]`);
  return [...found];
}

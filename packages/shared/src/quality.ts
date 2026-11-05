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

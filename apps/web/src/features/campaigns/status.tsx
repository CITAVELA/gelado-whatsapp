import type { CampaignDto } from '@gelado/shared';
import { LABELS_ES } from '@gelado/shared';

/** Etiqueta de estado como en la maqueta: «Enviando · 42 %». */
export function statusLabel(c: Pick<CampaignDto, 'status' | 'sentCount' | 'totalRecipients' | 'failedCount'>): string {
  if (c.status === 'RUNNING') {
    const done = c.totalRecipients ? Math.round(((c.sentCount + c.failedCount) / c.totalRecipients) * 100) : 0;
    return `Enviando · ${done} %`;
  }
  return LABELS_ES.campaignStatus[c.status];
}

const PILL: Record<string, string> = {
  DRAFT: 'p-grey',
  SCHEDULED: 'p-blue',
  RUNNING: 'p-warn',
  PAUSED: 'p-warn',
  COMPLETED: 'p-ok',
  CANCELLED: 'p-grey',
  FAILED: 'p-bad',
};

export function CampaignStatusPill({ c }: { c: Pick<CampaignDto, 'status' | 'sentCount' | 'totalRecipients' | 'failedCount'> }) {
  return <span className={`pill ${PILL[c.status] ?? 'p-grey'}`}>{statusLabel(c)}</span>;
}

export const pctOf = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);
export const pct1 = (part: number, total: number) => (total ? `${(Math.round((part / total) * 1000) / 10).toLocaleString('es-ES')} %` : '0 %');

import type { ContactCampaignDto, RecipientStatus } from '@gelado/shared';
import { fmtDate } from '../../lib/format';
import { useContactCampaigns } from './hooks';

const REC_ES: Record<RecipientStatus, { t: string; c: string }> = {
  QUEUED: { t: 'En cola', c: 'p-grey' }, SENDING: { t: 'Enviando', c: 'p-grey' }, SENT: { t: 'Enviada', c: 'p-grey' },
  DELIVERED: { t: 'Entregada', c: 'p-grey' }, READ: { t: 'Leída', c: 'p-blue' }, FAILED: { t: 'Fallida', c: 'p-bad' }, SKIPPED: { t: 'Omitida', c: 'p-warn' },
};

export function recipientLabel(c: ContactCampaignDto) {
  if (c.repliedAt) return { t: 'Respondió', c: 'p-ok' };
  return REC_ES[c.status] ?? { t: c.status, c: 'p-grey' };
}

/** «Últimas campañas» / «Campañas recibidas». */
export function CampaignsList({ contactId, limit }: { contactId: string; limit?: number }) {
  const q = useContactCampaigns(contactId);
  if (q.isLoading) return <div className="hint">Cargando…</div>;
  const items = (q.data ?? []).slice(0, limit);
  if (!items.length) return <div className="hint">Todavía no ha recibido campañas.</div>;
  return (
    <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((c) => {
        const l = recipientLabel(c);
        return (
          <div key={c.campaignId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span title={c.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}{c.sentAt ? <span className="hint"> · {fmtDate(c.sentAt)}</span> : null}</span>
            <span className={`pill ${l.c}`} title={c.skipReason ?? undefined}>{l.t}</span>
          </div>
        );
      })}
    </div>
  );
}

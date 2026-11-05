import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CampaignDto, CampaignRecipientDto } from '@gelado/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime, fmtEur, fmtNumber } from '../../lib/format';
import { Icon } from '../../components/Icon';
import { ConfirmModal, Empty, Spinner, useToast } from '../../components/ui';
import { TemplatePreview } from '../templates/TemplatePreview';
import { useTemplates } from '../templates/queries';
import { CampaignStatusPill, pct1, pctOf } from './status';
import { invalidateCampaigns, useCampaignReport, useDebounced, useRecipients, type RecipientTab } from './queries';
import { previewValues } from './CampaignWizard';
import './campaigns.css';

const TABS: Array<{ id: RecipientTab; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'delivered', label: 'Entregado' },
  { id: 'read', label: 'Leído' },
  { id: 'replied', label: 'Respondido' },
  { id: 'failed', label: 'Fallido' },
  { id: 'skipped', label: 'Omitido' },
];

function recipientPill(r: CampaignRecipientDto) {
  if (r.optedOutAt) return <span className="pill p-bad">Se dio de baja</span>;
  if (r.repliedAt) return <span className="pill p-ok">Respondido</span>;
  switch (r.status) {
    case 'READ': return <span className="pill p-blue">Leído</span>;
    case 'DELIVERED': return <span className="pill p-ok">Entregado</span>;
    case 'SENT': return <span className="pill p-grey">Enviado</span>;
    case 'FAILED': return <span className="pill p-bad">Fallido{r.errorTitle ? ` · ${r.errorTitle}` : ''}</span>;
    case 'SKIPPED': return <span className="pill p-grey">Omitido</span>;
    case 'SENDING': return <span className="pill p-warn">Enviando</span>;
    default: return <span className="pill p-grey">En cola</span>;
  }
}

function recipientDate(r: CampaignRecipientDto) {
  return r.repliedAt ?? r.readAt ?? r.deliveredAt ?? r.sentAt ?? r.plannedFor;
}

export function CampaignReport() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { data: rep, isLoading, error } = useCampaignReport(id);
  const templates = useTemplates({});
  const [tab, setTab] = useState<RecipientTab>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const recipients = useRecipients(id, tab, q, page);
  const [action, setAction] = useState<null | 'pause' | 'resume' | 'cancel'>(null);

  if (isLoading) return <div className="empty"><Spinner /></div>;
  if (error || !rep) return <Empty>No se ha podido cargar la campaña: {(error as Error | null)?.message ?? 'no existe'}</Empty>;
  const c = rep.campaign;
  const tpl = templates.data?.find((t) => t.id === c.templateId);
  const sent = rep.funnel.sent;
  const failedTotal = rep.failureReasons.reduce((s, r) => s + r.count, 0);
  const maxFail = Math.max(1, ...rep.failureReasons.map((r) => r.count));
  const started = c.status !== 'DRAFT' && c.status !== 'SCHEDULED';

  async function run(a: 'pause' | 'resume' | 'cancel') {
    try {
      await api.post(`/api/campaigns/${id}/${a}`);
      await invalidateCampaigns();
      toast(a === 'pause' ? 'Campaña pausada' : a === 'resume' ? 'Campaña reanudada' : 'Campaña cancelada');
    } catch (e) {
      toast((e as Error).message, true);
      throw e;
    }
  }

  async function duplicate() {
    try {
      const copy = await api.post<CampaignDto>(`/api/campaigns/${id}/duplicate`);
      await invalidateCampaigns();
      toast('Campaña duplicada como borrador');
      nav(`/campanas/${copy.id}/editar`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  const mapping = c.variableMapping;
  const stop = c.stopReason;
  const pages = recipients.data ? Math.max(1, Math.ceil(recipients.data.total / recipients.data.pageSize)) : 1;

  return (
    <div className="cmp-report">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Link className="btn ghost" to="/campanas">‹ Volver al resumen</Link>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isAdmin && (c.status === 'RUNNING' || c.status === 'SCHEDULED') && <button className="btn" onClick={() => setAction('pause')}><Icon name="pause" small /> Pausar</button>}
            {isAdmin && c.status === 'PAUSED' && <button className="btn primary" onClick={() => setAction('resume')}><Icon name="play" small /> Reanudar</button>}
            {isAdmin && ['RUNNING', 'PAUSED', 'SCHEDULED'].includes(c.status) && <button className="btn danger" onClick={() => setAction('cancel')}>Cancelar campaña</button>}
            <button className="btn" onClick={duplicate}>Duplicar</button>
            {isAdmin && started && (
              <a className="btn" href={`/api/campaigns/${id}/export`} download><Icon name="download" small /> Exportar CSV</a>
            )}
          </div>
        </div>

        {stop && <div className={`cmp-stop${c.status === 'PAUSED' ? ' warn' : ''}`} role="alert"><b>{c.status === 'FAILED' ? 'Campaña detenida.' : 'Campaña pausada automáticamente.'}</b> {stop}</div>}

        <div className="panel" style={{ padding: '16px 20px', display: 'flex', gap: 30, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{c.name}</div>
            <div className="hint">Creada el {fmtDateTime(c.createdAt)} por {c.createdBy.name} · Plantilla «{c.templateName}»</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 18, fontSize: 13, flexWrap: 'wrap' }}>
            <span><span className="hint">Estado</span><br /><CampaignStatusPill c={c} /></span>
            <span><span className="hint">{c.startedAt ? 'Fecha de envío' : 'Programada para'}</span><br /><b>{fmtDateTime(c.startedAt ?? c.scheduledAt) || '—'}</b></span>
            {c.completedAt && <span><span className="hint">Terminó</span><br /><b>{fmtDateTime(c.completedAt)}</b></span>}
          </div>
        </div>

        <div className="cmp-cards">
          <div className="panel stat"><div className="k">Enviados</div><div className="v">{fmtNumber(sent)}</div><div className="s">de {fmtNumber(c.totalRecipients)}</div></div>
          <div className="panel stat"><div className="k">Entregados</div><div className="v">{fmtNumber(rep.funnel.delivered)}</div><div className="s">{pctOf(rep.funnel.delivered, sent)} %</div></div>
          <div className="panel stat"><div className="k">Leídos</div><div className="v">{fmtNumber(rep.funnel.read)}</div><div className="s">{pctOf(rep.funnel.read, sent)} %</div></div>
          <div className="panel stat"><div className="k">Respondidos</div><div className="v">{fmtNumber(rep.funnel.replied)}</div><div className="s">{pctOf(rep.funnel.replied, sent)} %</div></div>
          <div className="panel stat"><div className="k">Fallidos</div><div className="v">{fmtNumber(c.failedCount)}</div><div className="s">{pct1(c.failedCount, c.totalRecipients)}</div></div>
          <div className="panel stat"><div className="k">Bajas</div><div className="v">{fmtNumber(c.optOutCount)}</div><div className="s">{pct1(c.optOutCount, sent)}</div></div>
          <div className="panel stat">
            <div className="k">Coste</div>
            <div className="v">{fmtEur(rep.cost.actual)}</div>
            <div className="s">{rep.cost.billableMessages ? `${fmtNumber(rep.cost.billableMessages)} facturables` : 'según Meta'}{rep.cost.estimated != null ? ` · est. ${fmtEur(rep.cost.estimated)}` : ''}</div>
          </div>
        </div>

        {rep.pending > 0 && (
          <div className="panel" style={{ padding: '12px 16px', fontSize: 13 }}>
            <b>{fmtNumber(rep.pending)}</b> pendientes de enviar{c.status === 'CANCELLED' ? ' (la campaña se canceló)' : ''}.
            {rep.remainingPlan.length > 1 && c.status !== 'CANCELLED' && (
              <> Reparto previsto por el límite diario de Meta: {rep.remainingPlan.map((p) => `${new Date(p.day + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}: ${fmtNumber(p.count)}`).join(' · ')}.</>
            )}
          </div>
        )}

        <div className="cmp-two">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Embudo de la campaña</div>
            <div className="funnel">
              {[
                { l: 'Enviados', n: sent, strong: false },
                { l: 'Entregados', n: rep.funnel.delivered, strong: false },
                { l: 'Leídos', n: rep.funnel.read, strong: true },
                { l: 'Respondidos', n: rep.funnel.replied, strong: true },
              ].map((f) => (
                <div className="col" key={f.l}>
                  <b className="mono">{fmtNumber(f.n)}</b>
                  <div className={`fill${f.strong ? ' strong' : ''}`} style={{ height: `${sent ? Math.max(2, pctOf(f.n, sent)) : 2}%` }} />
                  <span className="lab">{f.l}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 700 }}>No entregados ({fmtNumber(failedTotal)})</div>
            {!rep.failureReasons.length && <div className="hint">Ningún mensaje ha fallado.</div>}
            {rep.failureReasons.map((r) => (
              <div className="cmp-reason" key={`${r.code}-${r.title}`}>
                <div className="row"><span>{r.title}{r.code ? <span className="hint"> · {r.code}</span> : null}</span><b className="mono">{fmtNumber(r.count)}</b></div>
                <div className="bar" style={{ marginTop: 4 }}><i style={{ width: `${(r.count / maxFail) * 100}%` }} /></div>
              </div>
            ))}
            {rep.skipReasons.length > 0 && (
              <>
                <div style={{ fontWeight: 700, marginTop: 6 }}>Omitidos ({fmtNumber(c.skippedCount)})</div>
                {rep.skipReasons.map((r) => (
                  <div className="cmp-reason" key={r.reason}><div className="row"><span>{r.title}</span><b className="mono">{fmtNumber(r.count)}</b></div></div>
                ))}
              </>
            )}
            <div className="hint">Los teléfonos no válidos quedan marcados en Contactos y no se vuelven a incluir.</div>
          </div>
        </div>

        <div className="panel" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <div className="tabs" style={{ margin: 0 }} role="tablist">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' on' : ''}`} style={{ padding: '6px 12px' }} onClick={() => { setTab(t.id); setPage(1); }}>
                  {t.label}
                  {recipients.data && <span className="cmp-tab-n">{fmtNumber(recipients.data.tabCounts[t.id])}</span>}
                </button>
              ))}
            </div>
            <div className="search" style={{ marginLeft: 'auto', minWidth: 220 }}>
              <Icon name="search" small />
              <input aria-label="Buscar destinatario" placeholder="Buscar…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ border: 0, outline: 'none', flex: 1, background: 'transparent' }} />
            </div>
          </div>
          {!recipients.data ? (
            <Empty><Spinner /></Empty>
          ) : !recipients.data.items.length ? (
            <Empty>{started ? 'Ningún destinatario en esta vista.' : 'Los destinatarios aparecen cuando la campaña arranca.'}</Empty>
          ) : (
            <table className="cmp-table">
              <tbody>
                {recipients.data.items.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.displayName}</td>
                    <td className="mono">{r.phoneE164}</td>
                    <td>{recipientPill(r)}{r.skipReason && r.status === 'SKIPPED' && <span className="hint"> · {skipText(r.skipReason)}</span>}</td>
                    <td className="hint">{fmtDateTime(recipientDate(r))}</td>
                    <td>{r.conversationId ? <Link to={`/bandeja/c/${r.conversationId}`}>Abrir chat</Link> : <Link to="/contactos">Ver contacto</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {recipients.data && recipients.data.total > recipients.data.pageSize && (
            <div className="cmp-pager">
              <span>{fmtNumber(recipients.data.total)} destinatarios · página {page} de {pages}</span>
              <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
              <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Siguiente</button>
            </div>
          )}
        </div>
      </div>

      <div className="panel" style={{ padding: 14, alignSelf: 'start' }}>
        <span className="label">Mensaje enviado</span>
        {tpl ? <TemplatePreview components={tpl.components} values={previewValues(mapping)} /> : <div className="hint">Plantilla «{c.templateName}»</div>}
      </div>

      {action && (
        <ConfirmModal
          title={action === 'pause' ? 'Pausar campaña' : action === 'resume' ? 'Reanudar campaña' : 'Cancelar campaña'}
          danger={action === 'cancel'}
          confirmText={action === 'pause' ? 'Pausar' : action === 'resume' ? 'Reanudar' : 'Cancelar campaña'}
          text={action === 'cancel' ? <>Se dejará de enviar. Lo que ya se envió no se puede deshacer y los {fmtNumber(rep.pending)} pendientes no recibirán el mensaje. ¿Seguro?</> : action === 'pause' ? <>No se enviará nada más hasta que la reanudes. Nadie recibirá el mensaje dos veces.</> : <>El envío continuará por donde se quedó.</>}
          onConfirm={() => run(action)}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}

function skipText(reason: string) {
  switch (reason) {
    case 'REVOKED': return 'dado de baja';
    case 'PHONE_INVALID': return 'teléfono no válido';
    case 'DUPLICATE': return 'duplicado';
    case 'DELETED': return 'contacto borrado';
    default: return reason;
  }
}

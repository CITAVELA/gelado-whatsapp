import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CampaignDto } from '@gelado/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime, fmtEur, fmtNumber } from '../../lib/format';
import { Icon } from '../../components/Icon';
import { Avatar, ConfirmModal, Empty, Spinner, useToast } from '../../components/ui';
import { CampaignStatusPill, pctOf } from './status';
import { invalidateCampaigns, useCampaigns } from './queries';

/** Fecha de envío que se enseña en la tabla: inicio real, o la programada. */
const sendDate = (c: CampaignDto) => c.startedAt ?? c.scheduledAt;

export function CampaignsList() {
  const nav = useNavigate();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { data, isLoading, error } = useCampaigns();
  const [q, setQ] = useState('');
  const [toDelete, setToDelete] = useState<CampaignDto | null>(null);

  const rows = useMemo(() => (data ?? []).filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())), [data, q]);

  // Resumen del mes en curso (Europe/Madrid)
  const stats = useMemo(() => {
    const ym = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }).slice(0, 7);
    const now = ym(new Date().toISOString());
    const month = (data ?? []).filter((c) => c.startedAt && ym(c.startedAt) === now);
    const sent = month.reduce((s, c) => s + c.sentCount, 0);
    return {
      n: month.length,
      recipients: month.reduce((s, c) => s + c.totalRecipients, 0),
      delivered: pctOf(month.reduce((s, c) => s + c.deliveredCount, 0), sent),
      read: pctOf(month.reduce((s, c) => s + c.readCount, 0), sent),
      cost: month.reduce((s, c) => s + (c.estimatedCost ?? 0), 0),
      messages: sent,
    };
  }, [data]);

  async function duplicate(c: CampaignDto) {
    try {
      const copy = await api.post<CampaignDto>(`/api/campaigns/${c.id}/duplicate`);
      await invalidateCampaigns();
      toast('Campaña duplicada como borrador');
      nav(`/campanas/${copy.id}/editar`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function remove(c: CampaignDto) {
    try {
      await api.del(`/api/campaigns/${c.id}`);
      await invalidateCampaigns();
      toast('Borrador borrado');
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  const open = (c: CampaignDto) => nav(c.status === 'DRAFT' ? `/campanas/${c.id}/editar` : `/campanas/${c.id}`);

  return (
    <div className="page" style={{ maxWidth: 1180, width: '100%', margin: '0 auto' }}>
      <div className="page-head">
        <div>
          <h1>Todas las campañas</h1>
          <div className="sub">Todas las campañas de WhatsApp planificadas y enviadas de un vistazo.</div>
        </div>
        <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => nav('/campanas/nueva')}>
          <Icon name="plus" small /> Nueva campaña
        </button>
      </div>
      <div className="grid4">
        <div className="panel stat"><div className="k">Enviadas este mes</div><div className="v">{stats.n}</div><div className="s">{fmtNumber(stats.recipients)} destinatarios</div></div>
        <div className="panel stat"><div className="k">Entregados</div><div className="v">{stats.delivered} %</div><div className="s">media del mes</div></div>
        <div className="panel stat"><div className="k">Leídos</div><div className="v">{stats.read} %</div><div className="s">media del mes</div></div>
        <div className="panel stat"><div className="k">Gasto estimado del mes</div><div className="v">{fmtEur(stats.cost)}</div><div className="s">{fmtNumber(stats.messages)} mensajes de marketing</div></div>
      </div>
      <div className="toolbar">
        <div style={{ fontWeight: 700, fontSize: 15 }}>Últimas campañas</div>
        <div className="search" style={{ marginLeft: 'auto' }}>
          <Icon name="search" small />
          <input aria-label="Buscar campaña" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 0, outline: 'none', flex: 1, background: 'transparent' }} />
        </div>
      </div>
      <div className="panel tbl-wrap">
        {isLoading ? (
          <Empty><Spinner /></Empty>
        ) : error ? (
          <Empty>No se han podido cargar las campañas: {(error as Error).message}</Empty>
        ) : !rows.length ? (
          <Empty>{data?.length ? 'Ninguna campaña coincide con la búsqueda.' : 'Todavía no hay campañas. Crea la primera con «Nueva campaña».'}</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>Nombre</th><th>Estado</th><th>Destinatarios</th><th>Entregados</th><th>Leídos</th><th>Creado por</th><th>Fecha de envío</th><th><span className="hint">Acciones</span></th></tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const started = c.status !== 'DRAFT' && c.status !== 'SCHEDULED';
                return (
                  <tr key={c.id} className="tpl-row" onClick={() => open(c)}>
                    <td style={{ fontWeight: 600 }}>
                      <a href={c.status === 'DRAFT' ? `/campanas/${c.id}/editar` : `/campanas/${c.id}`} onClick={(e) => { e.preventDefault(); open(c); }} style={{ color: 'var(--ink)' }}>{c.name}</a>
                      {c.stopReason && <div className="hint" style={{ color: 'var(--bad)', fontWeight: 400 }}>{c.stopReason}</div>}
                    </td>
                    <td><CampaignStatusPill c={c} /></td>
                    <td className="mono">{fmtNumber(c.totalRecipients)}</td>
                    <td className={started ? 'mono' : 'hint'}>{started ? `${fmtNumber(c.deliveredCount)} · ${pctOf(c.deliveredCount, c.sentCount)} %` : '—'}</td>
                    <td className={started ? 'mono' : 'hint'}>{started ? `${fmtNumber(c.readCount)} · ${pctOf(c.readCount, c.sentCount)} %` : '—'}</td>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Avatar name={c.createdBy.name} small />{c.createdBy.name}</div></td>
                    <td className={sendDate(c) ? 'mono' : 'hint'}>{sendDate(c) ? fmtDateTime(sendDate(c)) : '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="cmp-actions">
                        <button className="tbtn" aria-label={`Duplicar ${c.name}`} title="Duplicar" onClick={() => duplicate(c)}><Icon name="copy" small /></button>
                        {isAdmin && c.status === 'DRAFT' && (
                          <button className="tbtn" aria-label={`Borrar ${c.name}`} title="Borrar borrador" onClick={() => setToDelete(c)}><Icon name="trash" small /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {toDelete && (
        <ConfirmModal title="Borrar borrador" danger confirmText="Borrar" text={<>Se borrará el borrador «{toDelete.name}». Esta acción no se puede deshacer.</>} onConfirm={() => remove(toDelete)} onClose={() => setToDelete(null)} />
      )}
    </div>
  );
}

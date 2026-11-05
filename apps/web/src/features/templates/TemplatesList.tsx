import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LABELS_ES, type TemplateDto } from '@gelado/shared';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Icon } from '../../components/Icon';
import { ConfirmModal, Empty, Modal, Spinner, useToast } from '../../components/ui';
import { TemplatePreview } from './TemplatePreview';
import { NoOptOutPill, QualityPill, TemplateStatusChip, templateTitle } from './chips';
import { invalidateTemplates, useTemplates } from './queries';
import type { DraftState } from './TemplateEditor';

const STATUSES = ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL'] as const;

export function TemplatesList() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<TemplateDto | null>(null);
  const [toDelete, setToDelete] = useState<TemplateDto | null>(null);
  const [syncing, setSyncing] = useState(false);
  const { data, isLoading, error } = useTemplates({ status, category, q });

  async function sync() {
    setSyncing(true);
    try {
      const r = await api.post<{ total: number; created: number; deleted: number }>('/api/templates/sync');
      toast(`Sincronizado con Meta: ${r.total} plantillas${r.created ? `, ${r.created} nuevas` : ''}${r.deleted ? `, ${r.deleted} retiradas` : ''}`);
      await invalidateTemplates();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSyncing(false);
    }
  }

  async function duplicate(t: TemplateDto) {
    try {
      const d = await api.post<DraftState>(`/api/templates/${t.id}/duplicate`);
      nav('/plantillas/nueva', { state: d });
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Plantillas de WhatsApp</h1>
        <span className="count">{data?.length ?? 0}</span>
        <span className="grow" style={{ flex: 1 }} />
        {isAdmin && (
          <>
            <button className="btn" onClick={sync} disabled={syncing}>
              <Icon name="refresh" small /> {syncing ? 'Sincronizando…' : 'Sincronizar'}
            </button>
            <button className="btn primary" onClick={() => nav('/plantillas/nueva')}>
              <Icon name="plus" small /> Nueva plantilla
            </button>
          </>
        )}
      </div>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" small />
          <input aria-label="Buscar plantilla" placeholder="Buscar por nombre" value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 0, outline: 'none', flex: 1, background: 'transparent' }} />
        </div>
        <select className="tpl-input" style={{ width: 170 }} aria-label="Filtrar por estado" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{LABELS_ES.templateStatus[s]}</option>
          ))}
        </select>
        <select className="tpl-input" style={{ width: 170 }} aria-label="Filtrar por categoría" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas las categorías</option>
          <option value="MARKETING">Marketing</option>
          <option value="UTILITY">Utilidad</option>
        </select>
      </div>

      <div className="panel tbl-wrap">
        {isLoading ? (
          <div style={{ padding: 24 }}><Spinner /></div>
        ) : error ? (
          <Empty>No se pudieron cargar las plantillas: {(error as Error).message}</Empty>
        ) : !data?.length ? (
          <Empty>{isAdmin ? 'No hay plantillas. Pulsa «Sincronizar» para traer las de Meta o crea una nueva.' : 'No hay plantillas.'}</Empty>
        ) : (
          <table className="tpl-table">
            <thead>
              <tr>
                <th>Plantilla</th><th>Categoría</th><th>Idioma</th><th>Estado</th><th>Calidad</th><th>Actualizada</th><th />
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} className="tpl-row" onClick={() => setDetail(t)}>
                  <td>
                    <div className="tpl-name">
                      <strong>{templateTitle(t)}</strong>
                      <span className="meta">{t.name}</span>
                    </div>
                  </td>
                  <td>{LABELS_ES.templateCategory[t.category]}</td>
                  <td>{t.language}</td>
                  <td>
                    <div className="toolbar" style={{ gap: 4 }}>
                      <TemplateStatusChip status={t.status} />
                      <NoOptOutPill t={t} />
                    </div>
                    {t.status === 'REJECTED' && t.rejectedReason && <div className="tpl-reason">Motivo de Meta: {t.rejectedReason}</div>}
                  </td>
                  <td><QualityPill score={t.qualityScore} /></td>
                  <td className="hint">{fmtDateTime(t.updatedAt)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {isAdmin && (
                      <div className="tpl-actions">
                        {t.status === 'REJECTED' ? (
                          <button className="btn" onClick={() => duplicate(t)}>Duplicar y corregir</button>
                        ) : t.category === 'MARKETING' && !t.hasOptOutButton ? (
                          <button className="btn" onClick={() => duplicate(t)}>Duplicar con botón de baja</button>
                        ) : (
                          <button className="btn ghost" aria-label={`Duplicar ${templateTitle(t)}`} onClick={() => duplicate(t)}><Icon name="copy" small /></button>
                        )}
                        <button className="btn ghost" aria-label={`Borrar ${templateTitle(t)}`} onClick={() => setToDelete(t)}><Icon name="trash" small /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <Modal title={templateTitle(detail)} onClose={() => setDetail(null)} width={460}>
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <TemplateStatusChip status={detail.status} />
            <NoOptOutPill t={detail} />
            <span className="hint">{LABELS_ES.templateCategory[detail.category]} · {detail.language}</span>
          </div>
          {detail.status === 'REJECTED' && detail.rejectedReason && <p className="tpl-errors">Meta la ha rechazado: {detail.rejectedReason}</p>}
          <TemplatePreview components={detail.components} />
          <p className="hint" style={{ marginTop: 10 }}>
            Nombre en Meta: <code>{detail.name}</code>
            {!detail.usableInCampaigns && detail.status === 'APPROVED' && ' · No se puede usar en campañas hasta duplicarla con el botón «No recibir más».'}
          </p>
        </Modal>
      )}
      {toDelete && (
        <ConfirmModal
          title="Borrar plantilla"
          danger
          confirmText="Borrar"
          text={<>Se borrará «{templateTitle(toDelete)}» también en Meta. Esta acción no se puede deshacer.</>}
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            try {
              await api.del(`/api/templates/${toDelete.id}`);
              toast('Plantilla borrada');
              await invalidateTemplates();
            } catch (e) {
              toast((e as Error).message, true);
            }
          }}
        />
      )}
    </div>
  );
}

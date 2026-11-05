import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Empty, Spinner } from '../../components/ui';
import { SectionHead } from './shared';

export interface AuditItem { id: string; action: string; entityType: string | null; entityId: string | null; data: unknown; ip: string | null; userName: string | null; createdAt: string }
interface AuditPage { items: AuditItem[]; total: number; page: number; pageSize: number }

export const AUDIT_ACTIONS_ES: Record<string, string> = {
  login: 'Inicio de sesión', logout: 'Cierre de sesión', login_failed: 'Intento de acceso fallido', set_password: 'Contraseña creada',
  invite_user: 'Invitación de usuario', update_user: 'Cambio de usuario', reset_link: 'Enlace de nueva contraseña', invite_link: 'Enlace de invitación',
  export_contacts: 'Exportación de contactos', delete_contact: 'Contacto borrado', hard_delete_contact: 'Contacto suprimido', import_contacts: 'Importación de contactos', consent_change: 'Cambio de consentimiento',
  create_template: 'Plantilla creada', delete_template: 'Plantilla borrada', sync_templates: 'Plantillas sincronizadas',
  launch_campaign: 'Campaña lanzada', schedule_campaign: 'Campaña programada', pause_campaign: 'Campaña pausada', resume_campaign: 'Campaña reanudada', cancel_campaign: 'Campaña cancelada', test_campaign: 'Prueba de campaña', export_campaign: 'Exportación de campaña', delete_campaign: 'Campaña borrada',
  update_setting: 'Ajuste modificado', library_upload: 'Archivo subido a la biblioteca', library_delete: 'Archivo borrado de la biblioteca', label_change: 'Etiqueta modificada',
};
export const actionLabel = (a: string) => AUDIT_ACTIONS_ES[a] ?? a;

const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : '');
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : '');

/** Ajustes → Registro de actividad (RF-1.5): tabla filtrable por acción y fechas. */
export function AuditSection() {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['audit', action, from, to, page],
    queryFn: () => api.get<AuditPage>(`/api/audit${qs({ action, from: dayStart(from), to: dayEnd(to), page, pageSize: 50 })}`),
    placeholderData: (p) => p,
  });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  return (
    <div className="set-page page">
      <SectionHead title="Registro de actividad" sub="Quién hizo qué y cuándo: accesos, exportaciones, campañas y cambios de ajustes." />
      <div className="toolbar">
        <select className="set-input" style={{ width: 260 }} aria-label="Acción" value={action} onChange={(e) => reset(setAction)(e.target.value)}>
          <option value="">Todas las acciones</option>
          {Object.entries(AUDIT_ACTIONS_ES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="row"><span className="hint">Desde</span><input type="date" className="set-input" style={{ width: 150 }} value={from} onChange={(e) => reset(setFrom)(e.target.value)} /></label>
        <label className="row"><span className="hint">Hasta</span><input type="date" className="set-input" style={{ width: 150 }} value={to} onChange={(e) => reset(setTo)(e.target.value)} /></label>
        {(action || from || to) && <button className="btn ghost" onClick={() => { setAction(''); setFrom(''); setTo(''); setPage(1); }}>Quitar filtros</button>}
        <span className="hint" style={{ marginLeft: 'auto' }}>{q.data ? `${q.data.total} registros` : ''}</span>
      </div>
      <div className="panel tbl-wrap">
        {q.isLoading ? <div className="empty"><Spinner /></div> : !q.data?.items.length ? <Empty>No hay actividad con estos filtros.</Empty> : (
          <table>
            <thead><tr><th>Fecha</th><th>Persona</th><th>Acción</th><th>Detalle</th><th>IP</th></tr></thead>
            <tbody>
              {q.data.items.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{fmtDateTime(a.createdAt)}</td>
                  <td>{a.userName ?? <span className="hint">Sistema</span>}</td>
                  <td>{actionLabel(a.action)}</td>
                  <td className="hint" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.entityType ? `${a.entityType}${a.entityId ? ` · ${a.entityId.slice(0, 8)}` : ''}` : ''}</td>
                  <td className="hint mono">{a.ip ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
          <span className="hint">Página {page} de {pages}</span>
          <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Siguiente</button>
        </div>
      )}
    </div>
  );
}

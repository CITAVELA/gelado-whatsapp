import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { LabelDto, LabelScope } from '@gelado/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { ConfirmModal, Empty, LabelChip, Modal, Spinner, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { SectionHead, errMsg } from './shared';

const SCOPES: Array<{ id: LabelScope; name: string; hint: string }> = [
  { id: 'CONTACT', name: 'Tipo de cliente', hint: 'Clasifican a los contactos (peluquería, barbería, estética…) y se usan para segmentar campañas.' },
  { id: 'CONVERSATION', name: 'Conversación', hint: 'Marcan el tema de una conversación (pedido, factura, transporte…). Pueden aparecer como bandeja en el menú de la bandeja de entrada.' },
];
const PALETTE = ['#1F5E33', '#C46A00', '#2457C5', '#7B3FA0', '#B4232A', '#1F6F8B', '#3A3F46', '#9B5B12'];

function LabelModal({ scope, label, onClose }: { scope: LabelScope; label: LabelDto | null; onClose: () => void }) {
  const [name, setName] = useState(label?.name ?? '');
  const [color, setColor] = useState(label?.color ?? PALETTE[0]!);
  const [showAsInboxView, setShow] = useState(label?.showAsInboxView ?? false);
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), color, scope, showAsInboxView: scope === 'CONVERSATION' ? showAsInboxView : false, sortOrder: label?.sortOrder ?? 0 };
      return label ? api.patch(`/api/labels/${label.id}`, body) : api.post('/api/labels', body);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['labels'] }); onClose(); },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal title={label ? 'Editar etiqueta' : 'Nueva etiqueta'} onClose={onClose} width={440} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={!name.trim() || m.isPending} onClick={() => m.mutate()}>Guardar</button>
    </>}>
      <form className="col" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) m.mutate(); }}>
        <label><span className="label">Nombre</span><input className="set-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <div>
          <span className="label">Color</span>
          <div className="set-row">
            {PALETTE.map((c) => (
              <button type="button" key={c} aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className="set-swatch" style={{ background: c, outline: color === c ? '2px solid var(--ink)' : 'none', outlineOffset: 2, cursor: 'pointer' }} />
            ))}
            <input type="color" className="set-color" aria-label="Otro color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} />
          </div>
        </div>
        {scope === 'CONVERSATION' && (
          <label className="row"><input type="checkbox" checked={showAsInboxView} onChange={(e) => setShow(e.target.checked)} />Mostrar como bandeja en el menú lateral de la bandeja de entrada</label>
        )}
        <div className="row"><span className="hint">Vista previa:</span><LabelChip label={{ name: name.trim().toUpperCase() || 'ETIQUETA', color }} /></div>
        {error && <div className="set-err" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

/** Ajustes → Etiquetas: dos pestañas (Tipo de cliente / Conversación). */
export function LabelsSection() {
  const toast = useToast();
  const [scope, setScope] = useState<LabelScope>('CONTACT');
  const [editing, setEditing] = useState<LabelDto | 'new' | null>(null);
  const [removing, setRemoving] = useState<LabelDto | null>(null);
  const labels = useQuery({ queryKey: ['labels', scope], queryFn: () => api.get<LabelDto[]>(`/api/labels?scope=${scope}`) });
  const current = SCOPES.find((s) => s.id === scope)!;
  const items = [...(labels.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'));
  const toggleInbox = async (l: LabelDto) => {
    try {
      await api.patch(`/api/labels/${l.id}`, { ...l, showAsInboxView: !l.showAsInboxView });
      void queryClient.invalidateQueries({ queryKey: ['labels'] });
    } catch (e) {
      toast(errMsg(e), true);
    }
  };

  return (
    <div className="set-page page">
      <SectionHead title="Etiquetas" sub={current.hint} actions={<button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" small />Nueva etiqueta</button>} />
      <div className="tabs" style={{ margin: 0, maxWidth: 360 }} role="tablist">
        {SCOPES.map((s) => <button key={s.id} role="tab" aria-selected={scope === s.id} className={`tab${scope === s.id ? ' on' : ''}`} onClick={() => setScope(s.id)}>{s.name}</button>)}
      </div>
      <div className="panel tbl-wrap">
        {labels.isLoading ? <div className="empty"><Spinner /></div> : labels.isError ? <Empty>Las etiquetas no están disponibles ahora mismo.</Empty> : !items.length ? <Empty>No hay etiquetas de este tipo.</Empty> : (
          <table>
            <thead><tr><th>Etiqueta</th><th>Color</th>{scope === 'CONVERSATION' && <th>Como bandeja</th>}<th><span className="hint">Acciones</span></th></tr></thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id}>
                  <td><LabelChip label={l} /></td>
                  <td><span className="row"><span className="set-swatch" style={{ background: l.color }} /><span className="hint mono">{l.color}</span></span></td>
                  {scope === 'CONVERSATION' && <td><input type="checkbox" aria-label={`${l.name} como bandeja`} checked={l.showAsInboxView} onChange={() => void toggleInbox(l)} /></td>}
                  <td><a href="#" onClick={(e) => { e.preventDefault(); setEditing(l); }}>Editar</a> · <a href="#" style={{ color: '#B4232A' }} onClick={(e) => { e.preventDefault(); setRemoving(l); }}>Borrar</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <LabelModal scope={scope} label={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmModal
          title="Borrar etiqueta"
          danger
          confirmText="Borrar"
          text={<>Se quitará la etiqueta «{removing.name}» de {scope === 'CONTACT' ? 'todos los contactos' : 'todas las conversaciones'} que la tengan. No se puede deshacer.</>}
          onConfirm={async () => {
            try {
              await api.del(`/api/labels/${removing.id}`);
              void queryClient.invalidateQueries({ queryKey: ['labels'] });
            } catch (e) {
              toast(errMsg(e), true);
              throw e;
            }
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

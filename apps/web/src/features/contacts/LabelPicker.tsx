import { useState } from 'react';
import type { LabelDto } from '@gelado/shared';
import { api } from '../../lib/api';
import { LabelChip, useDropdown, useToast } from '../../components/ui';
import { errMsg, keys, useLabels } from './hooks';
import { useQueryClient } from '@tanstack/react-query';

/** Etiquetas de contacto con «+ Etiqueta» (elegir una existente o crear otra). Guarda a través de onChange. */
export function LabelPicker({ value, onChange, disabled }: { value: LabelDto[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const labels = useLabels('CONTACT');
  const dd = useDropdown();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const ids = value.map((l) => l.id);
  const free = (labels.data ?? []).filter((l) => !ids.includes(l.id));
  async function create() {
    const n = name.trim();
    if (!n) return;
    try {
      const l = await api.post<LabelDto>('/api/labels', { name: n, color: '#6B737C', scope: 'CONTACT' });
      qc.invalidateQueries({ queryKey: ['labels'] });
      qc.setQueryData(keys.labels('CONTACT'), (old: LabelDto[] | undefined) => [...(old ?? []), l]);
      setName('');
      dd.setOpen(false);
      onChange([...ids, l.id]);
    } catch (e) {
      toast(errMsg(e), true);
    }
  }
  return (
    <div className="row ct-rel" style={{ flexWrap: 'wrap', gap: 6 }} ref={dd.ref}>
      {value.map((l) => <LabelChip key={l.id} label={l} onRemove={disabled ? undefined : () => onChange(ids.filter((x) => x !== l.id))} />)}
      {!disabled && <button className="btn ghost" style={{ height: 22, padding: '0 6px', fontSize: 12 }} onClick={() => dd.setOpen(!dd.open)} aria-haspopup="listbox" aria-expanded={dd.open}>+ Etiqueta</button>}
      {dd.open && (
        <div className="ct-pop" style={{ top: '100%', left: 0, marginTop: 4 }} role="listbox" aria-label="Etiquetas de contacto">
          {free.length === 0 && <div className="hint" style={{ padding: 6 }}>No quedan etiquetas por añadir.</div>}
          {free.map((l) => (
            <button key={l.id} role="option" aria-selected={false} className="mi" style={{ border: 0, background: 'transparent', width: '100%', textAlign: 'left' }}
              onClick={() => { dd.setOpen(false); onChange([...ids, l.id]); }}>
              <span className="sw" style={{ background: l.color }} />{l.name}
            </button>
          ))}
          <div className="sep" />
          <div className="row" style={{ padding: 4 }}>
            <input className="field" style={{ height: 30 }} placeholder="Nueva etiqueta" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} aria-label="Nombre de la nueva etiqueta" />
            <button className="btn" style={{ height: 30 }} onClick={create}>Crear</button>
          </div>
        </div>
      )}
    </div>
  );
}

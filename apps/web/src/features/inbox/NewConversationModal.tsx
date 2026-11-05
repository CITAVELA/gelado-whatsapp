import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/ui';
import { inboxApi } from './api';
import { K, errMsg } from './hooks';

/** «Nueva conversación»: teléfono (y nombre opcional) → POST /api/conversations. */
export function NewConversationModal({ onClose }: { onClose: () => void }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phone.trim().length < 3) return setError('Escribe un teléfono');
    setBusy(true);
    setError(null);
    try {
      const c = await inboxApi.newConversation({ phone: phone.trim(), firstName: name.trim() || undefined });
      qc.invalidateQueries({ queryKey: K.lists });
      qc.invalidateQueries({ queryKey: K.counts });
      onClose();
      navigate(`/bandeja/c/${c.id}`);
    } catch (err) {
      setError(errMsg(err, 'No se ha podido crear la conversación'));
      setBusy(false);
    }
  }

  return (
    <Modal title="Nueva conversación" width={440} onClose={onClose}>
      <form className="col" onSubmit={submit} style={{ gap: 14 }}>
        <label>
          <span className="label">Teléfono</span>
          <input className="field" autoFocus inputMode="tel" placeholder="+34 600 000 000" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <span className="hint">Si no pones prefijo, se usa +34.</span>
        </label>
        <label>
          <span className="label">Nombre (opcional)</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="hint">Como el cliente no ha escrito antes, el primer mensaje tiene que ser una plantilla aprobada.</div>
        {error && <div className="err" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={busy}>Crear conversación</button>
        </div>
      </form>
    </Modal>
  );
}

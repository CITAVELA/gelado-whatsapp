import { useState } from 'react';
import { LABELS_ES, type ConsentChangeDto, type ConsentStatus, type ContactDto } from '@gelado/shared';
import { ConfirmModal, ConsentPill, Modal } from '../../components/ui';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { CONSENT_SOURCES_MANUAL, errMsg, useChangeConsent, useConsentHistory } from './hooks';

const STATUS_OPTIONS: Array<{ value: ConsentStatus; label: string }> = [
  { value: 'UNKNOWN', label: LABELS_ES.consent.UNKNOWN },
  { value: 'GRANTED', label: LABELS_ES.consent.GRANTED },
  { value: 'REVOKED', label: LABELS_ES.consent.REVOKED },
];

/** Formulario de cambio de consentimiento con origen y nota (también lo usan las acciones en bloque). */
export function ConsentChangeModal({ title = 'Cambiar consentimiento', initial, from, count, onSubmit, onClose }: {
  title?: string;
  initial?: ConsentStatus;
  /** estado actual: si es «Dado de baja» se avisa de que se reactiva a mano */
  from?: ConsentStatus;
  count?: number;
  onSubmit: (dto: ConsentChangeDto) => Promise<unknown>;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ConsentStatus>(initial ?? 'REVOKED');
  const [source, setSource] = useState<ConsentChangeDto['source']>('MANUAL');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reactivating = from === 'REVOKED' && status !== 'REVOKED';
  return (
    <Modal title={title} onClose={onClose} width={480} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className={`btn ${status === 'REVOKED' ? 'danger' : 'primary'}`} disabled={busy || (reactivating && !note.trim())}
        onClick={async () => {
          setBusy(true); setError('');
          try { await onSubmit({ status, source, note: note.trim() || undefined }); onClose(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
        }}>{status === 'REVOKED' ? 'Dar de baja' : 'Guardar'}</button>
    </>}>
      <div className="col" style={{ gap: 12 }}>
        {count ? <div className="hint">Se aplicará a {count} contacto{count === 1 ? '' : 's'}.</div> : null}
        <div>
          <label className="label" htmlFor="cc-status">Estado</label>
          <select id="cc-status" className="field" value={status} onChange={(e) => setStatus(e.target.value as ConsentStatus)}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="cc-source">Origen</label>
          <select id="cc-source" className="field" value={source} onChange={(e) => setSource(e.target.value as ConsentChangeDto['source'])}>
            {CONSENT_SOURCES_MANUAL.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="cc-note">Nota{reactivating ? ' (obligatoria para reactivar)' : ''}</label>
          <textarea id="cc-note" className="area" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: lo pidió por teléfono el 5/11" />
        </div>
        {reactivating && <div className="hint ct-warn">Este contacto se dio de baja. Reactivarlo solo se hace a mano y queda registrado con tu nombre.</div>}
        {error && <div className="err" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

/** Estado de consentimiento con fecha, origen e historial. */
export function ConsentBlock({ contact }: { contact: ContactDto }) {
  const change = useChangeConsent(contact.id);
  const hist = useConsentHistory(contact.id);
  const [modal, setModal] = useState<'change' | 'revoke' | null>(null);
  const [showHist, setShowHist] = useState(false);
  const last = hist.data?.[0];
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <ConsentPill status={contact.consentStatus} />
        {contact.phoneInvalid && <span className="pill p-warn">Teléfono no válido</span>}
      </div>
      <div className="hint">
        {contact.consentAt ? `Desde ${fmtDate(contact.consentAt)}` : 'Sin cambios registrados'}
        {last ? ` · ${LABELS_ES.consentSource[last.source]}${last.userName ? ` · ${last.userName}` : ''}` : ''}
      </div>
      {last?.note && <div className="hint">«{last.note}»</div>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {contact.consentStatus !== 'REVOKED' && (
          <button className="btn danger" style={{ height: 32 }} onClick={() => setModal('revoke')}>Dar de baja de publicidad</button>
        )}
        <button className="btn" style={{ height: 32 }} onClick={() => setModal('change')}>{contact.consentStatus === 'REVOKED' ? 'Reactivar…' : 'Cambiar…'}</button>
        <button className="btn ghost" style={{ height: 32 }} onClick={() => setShowHist((v) => !v)} aria-expanded={showHist}>{showHist ? 'Ocultar historial' : 'Historial'}</button>
      </div>
      {showHist && (
        <div className="ct-hist" aria-label="Historial de consentimiento">
          {hist.isLoading && <span className="hint">Cargando…</span>}
          {hist.data?.length === 0 && <span className="hint">Sin cambios registrados.</span>}
          {hist.data?.map((e) => (
            <div key={e.id} className="h">
              <span className="hint mono" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.createdAt)}</span>
              <span><b>{LABELS_ES.consent[e.status]}</b> · {LABELS_ES.consentSource[e.source]}{e.userName ? ` · ${e.userName}` : ''}{e.note ? ` · «${e.note}»` : ''}</span>
            </div>
          ))}
        </div>
      )}
      {modal === 'revoke' && (
        <ConfirmModal title="Dar de baja de publicidad" danger confirmText="Dar de baja"
          text={<>Este contacto <b>no recibirá más campañas</b> de marketing. Podrás reactivarlo a mano.</>}
          onConfirm={async () => { await change.mutateAsync({ status: 'REVOKED', source: 'MANUAL', note: 'Baja manual desde la ficha' }); }} onClose={() => setModal(null)} />
      )}
      {modal === 'change' && (
        <ConsentChangeModal initial="GRANTED" from={contact.consentStatus}
          onSubmit={(dto) => change.mutateAsync(dto)} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

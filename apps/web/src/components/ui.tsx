// Componentes comunes con las clases de las maquetas (gelado-app.css). Los usan todas las pantallas.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LabelDto, ConsentStatus } from '@gelado/shared';
import { LABELS_ES } from '@gelado/shared';
import { Icon } from './Icon';
import { initials } from '../lib/format';

// ── Toasts ──
type Toast = { id: number; text: string; bad?: boolean };
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, bad }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.bad ? ' bad' : ''}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
/** const toast = useToast(); toast('Guardado'); toast(error.message, true) */
export const useToast = () => useContext(ToastCtx);

// ── Modal ──
export function Modal({ title, onClose, children, width = 560, footer }: { title: string; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} style={{ width, maxWidth: '96vw', maxHeight: '92vh' }}>
        <div className="row" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <strong className="grow" style={{ fontSize: 15 }}>{title}</strong>
          <button className="tbtn" aria-label="Cerrar" onClick={onClose}><Icon name="close" small /></button>
        </div>
        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && <div className="row" style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, text, confirmText = 'Confirmar', danger, onConfirm, onClose }: { title: string; text: ReactNode; confirmText?: string; danger?: boolean; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} width={440} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{confirmText}</button>
    </>}>
      <div>{text}</div>
    </Modal>
  );
}

// ── Etiquetas y chips ──
/** Chip de etiqueta con su color (fondo suave, borde y texto del color). */
export function LabelChip({ label, onRemove }: { label: Pick<LabelDto, 'name' | 'color'>; onRemove?: () => void }) {
  const c = label.color;
  return (
    <span className="chip" style={{ background: `${c}1A`, color: c, borderColor: `${c}40` }}>
      {label.name}
      {onRemove && <button aria-label={`Quitar ${label.name}`} onClick={onRemove} style={{ border: 0, background: 'transparent', color: 'inherit', padding: 0, lineHeight: 1 }}>×</button>}
    </span>
  );
}

export function ConsentPill({ status }: { status: ConsentStatus }) {
  const cls = status === 'REVOKED' ? 'p-bad' : status === 'GRANTED' ? 'p-ok' : 'p-grey';
  return <span className={`pill ${cls}`}>{LABELS_ES.consent[status]}</span>;
}

const AV_COLORS = ['#7B3FA0', '#1F6F8B', '#9B5B12', '#3A3F46', '#2457C5', '#1E7A3D'];
export function Avatar({ name, small, title }: { name: string; small?: boolean; title?: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return <div className={`avatar${small ? ' sm' : ''}`} style={{ background: AV_COLORS[h % AV_COLORS.length] }} title={title ?? name}>{initials(name)}</div>;
}

export function Spinner() {
  return <span className="spinner" role="progressbar" aria-label="Cargando" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? ' on' : ''}`} style={{ border: 0 }} onClick={() => onChange(!on)} />;
}

/** Hook de menú desplegable con cierre al hacer clic fuera. */
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return { open, setOpen, ref };
}

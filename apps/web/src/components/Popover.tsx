// Menú desplegable anclado a un botón (portal + posición fija: no lo recortan las listas con scroll).
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface PopoverProps {
  /** botón o elemento que abre el menú (un clic en él alterna) */
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  minWidth?: number;
  label?: string;
  /** clase extra del contenedor del trigger */
  className?: string;
  onOpenChange?: (open: boolean) => void;
}

export function Popover({ trigger, children, align = 'left', minWidth = 230, label, className, onOpenChange }: PopoverProps) {
  const [open, setOpenState] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  };

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const a = anchor.current.getBoundingClientRect();
    const p = panel.current.getBoundingClientRect();
    const m = 8;
    let left = align === 'right' ? a.right - p.width : a.left;
    left = Math.max(m, Math.min(left, window.innerWidth - p.width - m));
    let top = a.bottom + 4;
    if (top + p.height > window.innerHeight - m) top = Math.max(m, a.top - p.height - 4);
    setPos({ left, top });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <span ref={anchor} className={`pop-anchor ${className ?? ''}`} onClick={(e) => { e.stopPropagation(); setOpen(!open); setPos(null); }}>
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="menu pop"
            role="menu"
            aria-label={label}
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, minWidth, visibility: pos ? 'visible' : 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            <MenuScope>{children(() => setOpen(false))}</MenuScope>
          </div>,
          document.body,
        )}
    </>
  );
}

// ── Elementos de menú ──
const Scope = createContext<{ openSub: string | null; setOpenSub: (id: string | null) => void }>({ openSub: null, setOpenSub: () => undefined });
/** true dentro de un submenú: sus elementos no deben cerrarlo al pasar el puntero (ni al tocarlos en una pantalla táctil). */
const InSub = createContext(false);
function MenuScope({ children }: { children: ReactNode }) {
  const [openSub, setOpenSub] = useState<string | null>(null);
  return <Scope.Provider value={{ openSub, setOpenSub }}>{children}</Scope.Provider>;
}

export function MenuItem({ icon, children, right, onClick, checked, red, active, disabled }: { icon?: string; children: ReactNode; right?: ReactNode; onClick?: () => void; checked?: boolean; red?: boolean; active?: boolean; disabled?: boolean }) {
  const { setOpenSub } = useContext(Scope);
  const inSub = useContext(InSub);
  return (
    <button type="button" role="menuitem" className={`mi${active ? ' on' : ''}${red ? ' red' : ''}`} disabled={disabled} onMouseEnter={inSub ? undefined : () => setOpenSub(null)} onClick={onClick}>
      {icon && <Icon name={icon} small />}
      <span className="mi-text">{children}</span>
      {checked ? <span className="r">✓</span> : right != null ? <span className="r mono">{right}</span> : null}
    </button>
  );
}

/** Elemento con submenú lateral («Posponer ›»). En pantallas estrechas se despliega debajo. */
export function SubMenu({ icon, label, children, minWidth = 240 }: { icon?: string; label: string; children: (close: () => void) => ReactNode; minWidth?: number }) {
  const id = useId();
  const { openSub, setOpenSub } = useContext(Scope);
  const open = openSub === id;
  const sub = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  const hoverAt = useRef(0);
  useLayoutEffect(() => {
    if (!open || !sub.current) return;
    const r = sub.current.getBoundingClientRect();
    setFlip(r.right > window.innerWidth - 8 && r.left - r.width > 0);
  }, [open]);
  return (
    <div className="sub-wrap" onMouseEnter={() => { hoverAt.current = Date.now(); setOpenSub(id); }}>
      <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} className={`mi${open ? ' on' : ''}`} onClick={(e) => {
        // Un toque dispara primero mouseenter (que abre) y luego click: ese clic no debe volver a cerrarlo.
        // Con ratón o teclado, pulsar un submenú abierto lo pliega (como indica aria-expanded).
        const touch = (e.nativeEvent as PointerEvent).pointerType === 'touch' || Date.now() - hoverAt.current < 400;
        setOpenSub(open && !touch ? null : id);
      }}>
        {icon && <Icon name={icon} small />}
        <span className="mi-text">{label}</span>
        <span className="r">›</span>
      </button>
      {open && (
        <div ref={sub} className={`menu submenu${flip ? ' flip' : ''}`} role="menu" aria-label={label} style={{ minWidth }}>
          <InSub.Provider value>{children(() => setOpenSub(null))}</InSub.Provider>
        </div>
      )}
    </div>
  );
}

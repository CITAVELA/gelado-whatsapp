import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/** Imagen ampliada a pantalla completa. Esc o clic fuera para cerrar. */
export function Lightbox({ src, alt, downloadName, onClose }: { src: string; alt?: string; downloadName?: string | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Imagen ampliada" onClick={onClose}>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <a className="lightbox-btn" href={src} download={downloadName ?? 'imagen'} aria-label="Descargar"><Icon name="download" /></a>
        <button className="lightbox-btn" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button>
      </div>
      <img src={src} alt={alt ?? 'Imagen'} onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  );
}

// Refrescos agrupados y respetuosos con la pestaña oculta (consumo en Render, docs/04).
// - Varias peticiones de refresco dentro de la ventana se convierten en UNA.
// - Con la pestaña oculta no se refresca: se marca «sucio» y se refresca al volver a ser visible.

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export interface BatchedRefresh {
  /** Pide un refresco (se ejecutará dentro de `windowMs`, o al volver a ser visible la pestaña). */
  request(windowMs?: number): void;
  dispose(): void;
}

export function createBatchedRefresh(run: () => void, defaultWindowMs = 4000): BatchedRefresh {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let dueAt = 0; // instante en que vence el temporizador en marcha

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const fire = () => {
    clear();
    if (hidden()) {
      dirty = true;
      return;
    }
    dirty = false;
    run();
  };
  const onVisibility = () => {
    if (!hidden() && dirty) fire();
  };
  let attached = false;
  const attach = () => {
    if (attached || typeof document === 'undefined') return;
    attached = true;
    document.addEventListener('visibilitychange', onVisibility);
  };

  return {
    request(windowMs = defaultWindowMs) {
      attach(); // tras un dispose (p. ej. el doble montaje de StrictMode) vuelve a escuchar
      if (hidden()) {
        dirty = true;
        return;
      }
      const due = Date.now() + windowMs;
      // Con un refresco lento ya pendiente (envíos de campaña, 30 s), una petición con ventana más corta
      // (un entrante de cliente, 4 s) lo adelanta: se reprograma con el mínimo de las dos.
      if (timer && dueAt <= due) return;
      clear();
      dueAt = due;
      timer = setTimeout(fire, windowMs);
    },
    dispose() {
      clear();
      attached = false;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

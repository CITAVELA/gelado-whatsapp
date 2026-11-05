// Notificaciones del navegador y sonido (RF-2.20). El permiso se pide solo desde un botón; el audio se desbloquea en el primer gesto.
let focusedConversationId: string | null = null;
export const setFocusedConversation = (id: string | null) => {
  focusedConversationId = id;
};
export const getFocusedConversation = () => focusedConversationId;

/** ¿Existe la API de notificaciones? No en iOS Safari normal (solo en una PWA instalada) ni en algunos navegadores incrustados. */
export function notificationsSupported() {
  return typeof window !== 'undefined' && typeof (window as any).Notification === 'function';
}
export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}
/**
 * Pide el permiso de notificaciones. Llamar SOLO desde un gesto del usuario (clic en un botón), nunca al cargar.
 * Compatible con el Safari antiguo, donde `requestPermission(callback)` no devuelve promesa.
 */
export function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return Promise.resolve('unsupported');
  return new Promise((resolve) => {
    let done = false;
    const finish = (p?: NotificationPermission) => {
      if (done) return;
      done = true;
      resolve(p ?? Notification.permission);
    };
    try {
      const r = Notification.requestPermission(finish) as Promise<NotificationPermission> | undefined;
      if (r && typeof r.then === 'function') r.then(finish, () => finish());
      // Safari antiguo: no devuelve promesa y responde solo por el callback
    } catch {
      finish();
    }
  });
}

type AudioCtor = typeof AudioContext;
let audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  const Ctx: AudioCtor | undefined = typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctx) return null;
  try {
    audioCtx = new Ctx();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

/**
 * Safari/WebKit (y Chrome con la política de autoplay) crean el AudioContext «suspended» si no hay un gesto del usuario:
 * se crea y se reanuda dentro de un gesto. Devuelve true si ya está sonando.
 */
export function unlockAudio(): boolean {
  const ctx = getAudioContext();
  if (!ctx) return false;
  if (ctx.state !== 'running') {
    try {
      void ctx.resume?.()?.catch?.(() => undefined);
    } catch {
      /* sin audio */
    }
  }
  return ctx.state === 'running';
}

const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown', 'click'] as const;
/** Desbloquea el audio en el primer gesto del usuario (y vuelve a intentarlo hasta que suene). Devuelve la función que lo desinstala. */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const off = () => UNLOCK_EVENTS.forEach((e) => window.removeEventListener(e, onGesture, true));
  function onGesture() {
    if (unlockAudio()) off();
  }
  UNLOCK_EVENTS.forEach((e) => window.addEventListener(e, onGesture, { capture: true, passive: true }));
  return off;
}

function scheduleBeep(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  [880, 1175].forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t0 + i * 0.14);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.14 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.14 + 0.12);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + i * 0.14);
    o.stop(t0 + i * 0.14 + 0.13);
  });
}

/** Dos pitidos cortos con WebAudio (sin archivos). Solo suena si el contexto está activo (ver `unlockAudio`). */
export function playBeep() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'running') return scheduleBeep(ctx);
    // suspendido (o «interrupted» en iOS tras una llamada): se intenta reanudar y solo suena si lo consigue enseguida
    const asked = Date.now();
    void ctx.resume?.()?.then?.(() => {
      if (ctx.state === 'running' && Date.now() - asked < 1500) scheduleBeep(ctx);
    }, () => undefined);
  } catch {
    /* sin audio */
  }
}

/** ¿Hay que avisar de un mensaje de esta conversación? No si el usuario la está viendo. */
export function shouldNotify(conversationId: string, notifyFlag: boolean): boolean {
  if (!notifyFlag) return false;
  const viewing = focusedConversationId === conversationId && typeof document !== 'undefined' && document.visibilityState === 'visible';
  return !viewing;
}

export function showNotification(title: string, body: string, onClick: () => void) {
  playBeep();
  if (notificationPermission() !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: '/favicon.svg', tag: 'gelado-inbox' });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    /* algunos navegadores móviles exigen Service Worker */
  }
}

// Notificaciones del navegador y sonido (RF-2.20). El permiso se pide solo desde un botón.
let focusedConversationId: string | null = null;
export const setFocusedConversation = (id: string | null) => {
  focusedConversationId = id;
};
export const getFocusedConversation = () => focusedConversationId;

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}
export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

let audioCtx: AudioContext | null = null;
/** Dos pitidos cortos con WebAudio (sin archivos). */
export function playBeep() {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    const ctx = audioCtx;
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

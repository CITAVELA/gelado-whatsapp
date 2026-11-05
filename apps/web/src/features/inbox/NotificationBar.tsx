// Aviso de la lista de conversaciones sobre las notificaciones del navegador (RF-2.20).
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { notificationPermission, requestNotificationPermission } from './notify';

export { notificationPermission };
type Perm = ReturnType<typeof notificationPermission>;

const IOS_MSG = 'En este navegador no hay notificaciones del sistema (en iPhone y iPad solo existen si añades la web a la pantalla de inicio). El sonido de aviso funciona con la bandeja abierta.';
const DENIED_MSG = 'Las notificaciones están bloqueadas en este navegador. Puedes permitirlas desde los ajustes del sitio (el candado de la barra de direcciones).';
const DISMISS_KEY = 'gelado:notif-bar-dismissed';
const read = () => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } };

/** Botón para activar las notificaciones (el permiso se pide solo al hacer clic) o, si no se pueden usar, un mensaje claro. */
export function NotificationBar({ perm, onPerm }: { perm: Perm; onPerm: (p: Perm) => void }) {
  const [dismissed, setDismissed] = useState(read);
  if (perm === 'granted') return null;
  if (perm === 'default') {
    return (
      <button type="button" className="notif-bar" onClick={async () => onPerm(await requestNotificationPermission())}>
        <Icon name="info" small /> Activar notificaciones del navegador
      </button>
    );
  }
  if (dismissed) return null;
  return (
    <div className="notif-bar info" role="note">
      <Icon name="info" small />
      <span className="grow" style={{ fontWeight: 500 }}>{perm === 'unsupported' ? IOS_MSG : DENIED_MSG}</span>
      <button type="button" className="icon-btn" aria-label="Cerrar aviso" onClick={() => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* sin almacenamiento */ } }}>
        <Icon name="close" small />
      </button>
    </div>
  );
}

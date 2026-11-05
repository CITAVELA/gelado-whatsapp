import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, useCallback } from 'react';
import type { AlertDto } from '@gelado/shared';
import { Icon } from '../components/Icon';
import { Popover, MenuItem } from '../components/Popover';
import { Avatar } from '../components/ui';
import { useAuth } from '../lib/auth';
import { queryClient } from '../lib/query';
import { api } from '../lib/api';
import { useSocketEvent } from '../lib/socket';
import { useInboxCounts } from '../features/inbox/hooks';
import { useInboxRealtime } from '../features/inbox/useInboxRealtime';

export { useInboxCounts };

function AlertBanner() {
  const { data } = useQuery({ queryKey: ['alerts'], queryFn: () => api.get<AlertDto[]>('/api/alerts'), refetchInterval: 120_000 });
  const [live, setLive] = useState<AlertDto[] | null>(null);
  useSocketEvent('alert', useCallback((p: { alerts: AlertDto[] }) => setLive(p.alerts), []));
  const alerts = live ?? data ?? [];
  const { isAdmin } = useAuth();
  if (!alerts.length) return null;
  async function resolve(id: string) {
    if (!window.confirm('¿Marcar este aviso como resuelto? Hazlo solo después de comprobar la cuenta en Meta.')) return;
    await api.post(`/api/alerts/${id}/resolve`).catch(() => undefined);
    setLive(null);
    void queryClient.invalidateQueries({ queryKey: ['alerts'] });
  }
  return (
    <>
      {alerts.map((a) => (
        <div key={a.id} className={`banner ${a.level === 'critical' ? 'crit' : 'warn'}`} role="alert">
          <Icon name="warn" small />
          <span className="grow">{a.message}</span>
          <NavLink to={a.link ?? '/calidad'}>Ver calidad</NavLink>
          {isAdmin && <button className="btn ghost" style={{ height: 28 }} onClick={() => void resolve(a.id)}>Marcar como resuelto</button>}
        </div>
      ))}
    </>
  );
}

const roleLabel = (r: string) => (r === 'ADMIN' ? 'Administradora' : 'Agente');

export function AppLayout() {
  const { user, isAdmin, logout } = useAuth();
  const counts = useInboxCounts();
  const unread = counts.data?.totalUnread ?? 0;
  useInboxRealtime();

  // título de la pestaña: «(17) Gelado WhatsApp»
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Gelado WhatsApp` : 'Gelado WhatsApp';
  }, [unread]);

  const badge = unread > 99 ? '99+' : unread;
  const nav = [
    { to: '/bandeja', icon: 'inbox', label: 'Bandeja de entrada', badge },
    { to: '/contactos', icon: 'contacts', label: 'Contactos' },
    { to: '/campanas', icon: 'campaigns', label: 'Campañas' },
    { to: '/plantillas', icon: 'templates', label: 'Plantillas' },
    { to: '/calidad', icon: 'quality', label: 'Calidad y costes', desktopOnly: true },
  ];
  const cls = ({ isActive }: { isActive: boolean }) => `rail-btn${isActive ? ' on' : ''}`;

  return (
    <div className="app">
      <nav className="rail" aria-label="Menú principal">
        <div className="logo" aria-label="Gelado"><span><b>G</b>ELADO</span></div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} className={(s) => `${cls(s)}${n.desktopOnly ? ' hide-mobile' : ''}`} aria-label={n.label} title={n.label}>
            <Icon name={n.icon} />
            {!!n.badge && <span className="dot" aria-label={`${n.badge} sin leer`}>{n.badge}</span>}
          </NavLink>
        ))}
        <div className="rail-sp" />
        {isAdmin && (
          <NavLink to="/ajustes" className={(s) => `${cls(s)} hide-mobile`} aria-label="Ajustes" title="Ajustes">
            <Icon name="settings" />
          </NavLink>
        )}
        <button className="rail-btn hide-mobile" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => logout()}>
          <Icon name="logout" />
        </button>
        {user && <span className="hide-mobile"><Avatar name={user.name} title={`${user.name} · ${roleLabel(user.role)}`} /></span>}
        <Popover
          className="show-mobile"
          align="right"
          label="Más opciones"
          trigger={<button className="rail-btn" aria-label="Más" aria-haspopup="menu"><Icon name="more" /></button>}
        >
          {(close) => (
            <>
              {user && <div className="hint menu-title">{user.name} · {roleLabel(user.role)}</div>}
              <NavLink to="/calidad" className="mi" onClick={close}><Icon name="quality" small />Calidad y costes</NavLink>
              {isAdmin && <NavLink to="/ajustes" className="mi" onClick={close}><Icon name="settings" small />Ajustes</NavLink>}
              <div className="sep" />
              <MenuItem icon="logout" red onClick={() => { close(); void logout(); }}>Cerrar sesión</MenuItem>
            </>
          )}
        </Popover>
      </nav>
      <div className="main-col">
        <AlertBanner />
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

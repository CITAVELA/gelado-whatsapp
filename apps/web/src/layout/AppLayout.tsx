import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, useCallback } from 'react';
import type { AlertDto, InboxCountsDto } from '@gelado/shared';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useSocketEvent } from '../lib/socket';
import { queryClient } from '../lib/query';

/** Contadores de la bandeja (los usa el menú, el título de la pestaña y la columna de vistas). */
export function useInboxCounts() {
  return useQuery({
    queryKey: ['inbox', 'counts'],
    queryFn: () => api.get<InboxCountsDto>('/api/conversations/counts'),
    refetchInterval: 60_000,
  });
}

function AlertBanner() {
  const { data } = useQuery({ queryKey: ['alerts'], queryFn: () => api.get<AlertDto[]>('/api/alerts'), refetchInterval: 60_000 });
  const [live, setLive] = useState<AlertDto[] | null>(null);
  useSocketEvent('alert', useCallback((p: { alerts: AlertDto[] }) => setLive(p.alerts), []));
  const alerts = live ?? data ?? [];
  if (!alerts.length) return null;
  return (
    <>
      {alerts.map((a) => (
        <div key={a.id} className={`banner ${a.level === 'critical' ? 'crit' : 'warn'}`} role="alert">
          <Icon name="warn" small />
          <span className="grow">{a.message}</span>
          <NavLink to={a.link ?? '/calidad'}>Ver calidad</NavLink>
        </div>
      ))}
    </>
  );
}

export function AppLayout() {
  const { user, isAdmin, logout } = useAuth();
  const counts = useInboxCounts();
  const unread = counts.data?.totalUnread ?? 0;

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Gelado WhatsApp` : 'Gelado WhatsApp';
  }, [unread]);
  useSocketEvent('badge.counts', useCallback((p: InboxCountsDto) => queryClient.setQueryData(['inbox', 'counts'], p), []));

  const nav = [
    { to: '/bandeja', icon: 'inbox', label: 'Bandeja de entrada', badge: unread },
    { to: '/contactos', icon: 'contacts', label: 'Contactos' },
    { to: '/campanas', icon: 'campaigns', label: 'Campañas' },
    { to: '/plantillas', icon: 'templates', label: 'Plantillas' },
    { to: '/calidad', icon: 'quality', label: 'Calidad y costes' },
  ];

  return (
    <div className="app">
      <nav className="rail" aria-label="Menú principal">
        <div className="logo" aria-label="Gelado"><span><b>G</b>ELADO</span></div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `rail-btn${isActive ? ' on' : ''}`} aria-label={n.label} title={n.label}>
            <Icon name={n.icon} />
            {!!n.badge && <span className="dot">{n.badge > 99 ? '99+' : n.badge}</span>}
          </NavLink>
        ))}
        <div className="rail-sp" />
        {isAdmin && (
          <NavLink to="/ajustes" className={({ isActive }) => `rail-btn${isActive ? ' on' : ''}`} aria-label="Ajustes" title="Ajustes">
            <Icon name="settings" />
          </NavLink>
        )}
        <button className="rail-btn" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => logout()}>
          <Icon name="logout" />
        </button>
        {user && <Avatar name={user.name} title={`${user.name} · ${user.role === 'ADMIN' ? 'Administradora' : 'Agente'}`} />}
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

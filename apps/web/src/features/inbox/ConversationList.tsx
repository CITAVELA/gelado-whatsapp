// Columna 2: buscador, pestañas, filtros rápidos y tarjetas de conversación con scroll infinito.
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ConversationListItemDto, LabelDto } from '@gelado/shared';
import { Icon } from '../../components/Icon';
import { Popover, MenuItem } from '../../components/Popover';
import { SearchInput } from '../../components/SearchInput';
import { Avatar, LabelChip, Spinner } from '../../components/ui';
import { fmtListTime } from '../../lib/format';
import { ConversationMenuButton } from './ConversationMenus';
import { TAB_STATUS, VIEW_TITLES, titleCase, toListParams, type InboxFilters, type Tab } from './filters';
import { useConversationList, useLabels, useNow, useUsers } from './hooks';
import { notificationPermission, requestNotificationPermission } from './notify';
import { KIND_PREVIEW, displayLabel, stripLeadingEmoji, fmtShortDateTime, previewIcon, remainingText, waInitials, windowExpiresSoon, windowRemainingMs } from './utils';

const TABS: { id: Tab; label: string }[] = [
  { id: 'open', label: 'Abiertos' },
  { id: 'snoozed', label: 'Pospuestas' },
  { id: 'done', label: 'Finalizadas' },
];

export function ConversationCard({ c, active, now }: { c: ConversationListItemDto; active: boolean; now: number }) {
  const { search } = useLocation();
  const name = displayLabel(c.displayName, c.phoneE164);
  const unread = c.unreadCount > 0;
  const icon = previewIcon(c.lastMessageKind);
  const text = c.lastMessagePreview ?? (c.lastMessageKind ? KIND_PREVIEW[c.lastMessageKind] : null) ?? 'Sin mensajes';
  const soon = c.status === 'OPEN' && windowExpiresSoon(c.windowExpiresAt, now);
  const labels = [...c.contactLabels, ...c.conversationLabels];
  return (
    <div className={`card${active ? ' on' : ''}`} role="listitem" data-unread={unread || undefined}>
      <Link className="card-link" to={`/bandeja/c/${c.id}${search}`} aria-label={`${name}${unread ? `, ${c.unreadCount} sin leer` : ''}`} aria-current={active ? 'true' : undefined}>
        <div className="wa">{waInitials(c.displayName, c.phoneE164)}</div>
        <div className="card-body">
          <div className="who">
            <span className="trunc">{name}</span>
            <span className="time">{c.status === 'SNOOZED' && c.snoozedUntil ? fmtShortDateTime(c.snoozedUntil) : fmtListTime(c.lastMessageAt)}</span>
          </div>
          {c.searchSnippet ? (
            <div className="prev snippet"><Icon name="search" small /> {c.searchSnippet}</div>
          ) : (
            <div className={`prev${unread ? ' unread' : ''}`}>{icon && <Icon name={icon} small />} {icon ? stripLeadingEmoji(text) : text}</div>
          )}
          <div className="meta">
            <span className="menu-slot" aria-hidden="true" />
            {labels.map((l) => <LabelChip key={l.id} label={l} />)}
            {soon && (
              <span className="warnclock" title="La ventana de 24 h está a punto de cerrarse">
                <Icon name="clock" small /> Quedan {remainingText(windowRemainingMs(c.windowExpiresAt, now))}
              </span>
            )}
            {!c.assignee && c.status === 'OPEN' && labels.length === 0 && <span className="hint">Sin asignar</span>}
            <span className="meta-right">
              {c.starred && <span className="star" aria-label="Marcado" title="Marcado">★</span>}
              {unread && <span className="badge" aria-label={`${c.unreadCount} sin leer`}>{c.unreadCount}</span>}
              {c.assignee && <Avatar small name={c.assignee.name} title={`Asignado a ${c.assignee.name}`} />}
            </span>
          </div>
        </div>
      </Link>
      <ConversationMenuButton
        conv={c}
        trigger={<button type="button" className="hbtn card-more" aria-label="Más acciones de la conversación" aria-haspopup="menu"><Icon name="more" small /></button>}
      />
    </div>
  );
}

function QuickFilters({ filters, onSelect, labels }: { filters: InboxFilters; onSelect: (p: Partial<Record<keyof InboxFilters, string | null>>) => void; labels: LabelDto[] }) {
  const users = useUsers();
  const topics = labels.filter((l) => l.scope === 'CONVERSATION');
  const active = !!filters.assignee || !!filters.topic;
  return (
    <Popover
      align="right"
      label="Filtros"
      minWidth={250}
      trigger={<button type="button" className={`tbtn${active ? ' filter-on' : ''}`} aria-label="Filtrar" aria-haspopup="menu"><Icon name="filter" small /></button>}
    >
      {(close) => (
        <>
          <div className="hint menu-title">Asignado a</div>
          <MenuItem checked={!filters.assignee} onClick={() => { onSelect({ assignee: null }); close(); }}>Cualquiera</MenuItem>
          {(users.data ?? []).filter((u) => u.active).map((u) => (
            <MenuItem key={u.id} checked={filters.assignee === u.id} onClick={() => { onSelect({ assignee: u.id }); close(); }}>{u.name}</MenuItem>
          ))}
          <div className="sep" />
          <div className="hint menu-title">Etiqueta de conversación</div>
          <MenuItem checked={!filters.topic} onClick={() => { onSelect({ topic: null }); close(); }}>Todas</MenuItem>
          {topics.map((l) => (
            <MenuItem key={l.id} checked={filters.topic === l.id} onClick={() => { onSelect({ topic: l.id }); close(); }}>
              <LabelChip label={l} />
            </MenuItem>
          ))}
        </>
      )}
    </Popover>
  );
}

export function ConversationList({
  filters, onSelect, activeId, viewsCollapsed, onShowViews, onNew,
}: {
  filters: InboxFilters;
  onSelect: (p: Partial<Record<keyof InboxFilters, string | null>>) => void;
  activeId: string | undefined;
  viewsCollapsed: boolean;
  onShowViews: () => void;
  onNew: () => void;
}) {
  const labels = useLabels().data ?? [];
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const params = toListParams(filters, dq);
  const list = useConversationList(params);
  const now = useNow(60_000);
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const [perm, setPerm] = useState(notificationPermission());

  const title = filters.label
    ? titleCase(labels.find((l) => l.id === filters.label)?.name ?? 'Etiqueta')
    : filters.topic
      ? titleCase(labels.find((l) => l.id === filters.topic)?.name ?? 'Tema')
      : VIEW_TITLES[filters.view];

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300 && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  };

  const empty =
    dq.trim() ? `Sin resultados para «${dq.trim()}».`
    : filters.tab === 'open' ? 'No hay conversaciones abiertas. ¡Todo al día!'
    : filters.tab === 'snoozed' ? 'No hay conversaciones pospuestas.'
    : 'No hay conversaciones finalizadas.';

  return (
    <section className="list" aria-label="Conversaciones">
      <div className="list-head">
        {viewsCollapsed && <button className="icon-btn hide-mobile" aria-label="Mostrar vistas" title="Mostrar vistas" onClick={onShowViews}><Icon name="menu" small /></button>}
        <button className="icon-btn show-mobile" aria-label="Mostrar vistas" onClick={onShowViews}><Icon name="menu" small /></button>
        <h1 className="trunc">{title}</h1>
        <button className={`icon-btn${searchOpen ? ' on' : ''}`} aria-label="Buscar" aria-pressed={searchOpen} onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setQ(''); }}><Icon name="search" small /></button>
        <button className="icon-btn solid" aria-label="Nueva conversación" onClick={onNew}><Icon name="edit" small /></button>
      </div>
      {searchOpen && (
        <div className="list-search">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, teléfono o texto…" label="Buscar conversaciones" autoFocus />
        </div>
      )}
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tab${filters.tab === t.id ? ' on' : ''}`} role="tab" aria-selected={filters.tab === t.id} onClick={() => onSelect({ tab: t.id })}>{t.label}</button>
        ))}
      </div>
      <div className="list-tools">
        <span>{TAB_STATUS[filters.tab] === 'SNOOZED' ? 'Próximamente vence ▾' : 'Más reciente ▾'}</span>
        <QuickFilters filters={filters} onSelect={onSelect} labels={labels} />
      </div>
      {perm === 'default' && (
        <button type="button" className="notif-bar" onClick={async () => setPerm(await requestNotificationPermission())}>
          <Icon name="info" small /> Activar notificaciones del navegador
        </button>
      )}
      <div className="cards" onScroll={onScroll} role="list" aria-label="Lista de conversaciones" aria-busy={list.isFetching}>
        {list.isLoading && <div className="empty"><Spinner /></div>}
        {list.isError && <div className="empty err">No se han podido cargar las conversaciones. <button className="btn" onClick={() => list.refetch()}>Reintentar</button></div>}
        {!list.isLoading && !list.isError && items.length === 0 && <div className="empty">{empty}</div>}
        {items.map((c) => <ConversationCard key={c.id} c={c} active={c.id === activeId} now={now} />)}
        {list.isFetchingNextPage && <div className="empty"><Spinner /></div>}
      </div>
    </section>
  );
}

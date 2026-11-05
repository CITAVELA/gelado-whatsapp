// Bandeja en tres columnas (P2): vistas · lista · conversación · ficha. Móvil: una columna (lista → conversación → ficha).
import { useEffect, useState } from 'react';
import { useMatch, useNavigate, useLocation } from 'react-router-dom';
import { ContactSidePanel } from '../contacts/ContactSidePanel';
import { Icon } from '../../components/Icon';
import { ConversationList } from './ConversationList';
import { ConversationPane } from './ConversationPane';
import { NewConversationModal } from './NewConversationModal';
import { ViewsColumn } from './ViewsColumn';
import { useInboxFilters } from './filters';
import { useConversation, useInboxCounts, useLabels } from './hooks';

function stored(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function store(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* sin almacenamiento */ }
}

export function InboxPage() {
  const match = useMatch('/bandeja/c/:conversationId');
  const id = match?.params.conversationId;
  const navigate = useNavigate();
  const { search } = useLocation();
  const [filters, update] = useInboxFilters();
  const counts = useInboxCounts();
  const labels = useLabels();
  const [viewsCollapsed, setViewsCollapsed] = useState(() => stored('inbox.viewsCollapsed'));
  const [infoOpen, setInfoOpen] = useState(() => stored('inbox.infoOpen'));
  const [mobileViews, setMobileViews] = useState(false);
  const [creating, setCreating] = useState(false);
  const conv = useConversation(id);

  useEffect(() => store('inbox.viewsCollapsed', viewsCollapsed), [viewsCollapsed]);
  useEffect(() => store('inbox.infoOpen', infoOpen), [infoOpen]);

  const view = id ? (infoOpen ? 'info' : 'chat') : 'list';
  return (
    <div className="inbox" data-mobile-view={view}>
      {!viewsCollapsed || mobileViews ? (
        <ViewsColumn
          filters={filters}
          onSelect={update}
          counts={counts.data}
          labels={labels.data ?? []}
          onCollapse={() => setViewsCollapsed(true)}
          mobileOpen={mobileViews}
          onCloseMobile={() => setMobileViews(false)}
        />
      ) : null}
      <ConversationList
        filters={filters}
        onSelect={update}
        activeId={id}
        viewsCollapsed={viewsCollapsed}
        onShowViews={() => { if (window.matchMedia?.('(max-width: 760px)').matches) setMobileViews(true); else setViewsCollapsed(false); }}
        onNew={() => setCreating(true)}
      />
      {id ? (
        <ConversationPane key={id} id={id} onBack={() => navigate(`/bandeja${search}`)} infoOpen={infoOpen} onToggleInfo={() => setInfoOpen((o) => !o)} />
      ) : (
        <main className="chat chat-empty" aria-label="Conversación">
          <div className="empty"><Icon name="chat" /><div>Selecciona una conversación</div></div>
        </main>
      )}
      {id && infoOpen && conv.data && (
        <div className="info-wrap">
          <ContactSidePanel contactId={conv.data.contactId} onClose={() => setInfoOpen(false)} />
        </div>
      )}
      {creating && <NewConversationModal onClose={() => setCreating(false)} />}
    </div>
  );
}

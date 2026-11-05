// Columna 1: vistas de la bandeja (plegable) con contadores.
import type { InboxCountsDto, InboxView, LabelDto } from '@gelado/shared';
import { Icon } from '../../components/Icon';
import { VIEW_TITLES, titleCase, type InboxFilters } from './filters';

const VIEW_ICONS: Record<InboxView, string> = { all: 'chat', mine: 'user', unassigned: 'userX', unread: 'dot', starred: 'star' };

export function ViewsColumn({
  filters, onSelect, counts, labels, onCollapse, mobileOpen, onCloseMobile,
}: {
  filters: InboxFilters;
  onSelect: (patch: Partial<Record<keyof InboxFilters, string | null>>) => void;
  counts: InboxCountsDto | undefined;
  labels: LabelDto[];
  onCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const contactViews = labels.filter((l) => l.scope === 'CONTACT' && l.showAsInboxView).sort((a, b) => a.sortOrder - b.sortOrder);
  const topicViews = labels.filter((l) => l.scope === 'CONVERSATION' && l.showAsInboxView).sort((a, b) => a.sortOrder - b.sortOrder);
  const plain = !filters.label && !filters.topic;
  const pick = (patch: Partial<Record<keyof InboxFilters, string | null>>) => {
    onSelect({ view: 'all', label: null, topic: null, ...patch });
    onCloseMobile();
  };
  return (
    <aside className={`views${mobileOpen ? ' mob-open' : ''}`} aria-label="Vistas de la bandeja">
      <div className="views-head">
        <h2>Bandeja de entrada</h2>
        <button className="tbtn hide-mobile" aria-label="Plegar vistas" title="Plegar" onClick={onCollapse}><Icon name="back" small /></button>
        <button className="tbtn show-mobile" aria-label="Cerrar vistas" onClick={onCloseMobile}><Icon name="close" small /></button>
      </div>
      {(Object.keys(VIEW_TITLES) as InboxView[]).map((v) => (
        <button key={v} type="button" className={`view${plain && filters.view === v ? ' on' : ''}`} aria-current={plain && filters.view === v ? 'page' : undefined} onClick={() => pick({ view: v })}>
          <Icon name={VIEW_ICONS[v]} small />
          <span className="grow trunc">{VIEW_TITLES[v]}</span>
          <span className="n">{counts?.views[v] ?? 0}</span>
        </button>
      ))}
      {contactViews.length > 0 && <div className="sect">Tipo de cliente</div>}
      {contactViews.map((l) => (
        <button key={l.id} type="button" className={`view${filters.label === l.id ? ' on' : ''}`} onClick={() => pick({ label: l.id })}>
          <span className="sw" style={{ background: l.color }} />
          <span className="grow trunc">{titleCase(l.name)}</span>
          <span className="n">{counts?.byLabel[l.id] ?? 0}</span>
        </button>
      ))}
      {topicViews.length > 0 && <div className="sect">Temas</div>}
      {topicViews.map((l) => (
        <button key={l.id} type="button" className={`view${filters.topic === l.id ? ' on' : ''}`} onClick={() => pick({ topic: l.id })}>
          <span className="sw" style={{ background: l.color }} />
          <span className="grow trunc">{titleCase(l.name)}</span>
          <span className="n">{counts?.byLabel[l.id] ?? 0}</span>
        </button>
      ))}
    </aside>
  );
}

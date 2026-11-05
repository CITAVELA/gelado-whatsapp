// Historial de la conversación: separadores de fecha, burbujas, eventos del sistema y carga hacia atrás.
import { Fragment, useLayoutEffect, useRef } from 'react';
import type { MessageDto, TimelineItemDto } from '@gelado/shared';
import { Spinner } from '../../components/ui';
import { MessageBubble } from './MessageBubble';
import { dayKey, fmtDayLabel, fmtShortDateTime } from './utils';

const keyOf = (it: TimelineItemDto) => (it.type === 'message' ? it.message.id : it.event.id);

export function Thread({
  conversationId, items, loading, hasMore, loadingMore, onLoadMore, onRetry, onReply, now,
}: {
  conversationId: string;
  items: TimelineItemDto[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: (messageId: string) => void;
  onReply?: (m: MessageDto) => void;
  now?: Date;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prev = useRef({ conv: '', first: '', last: '', height: 0 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const first = items.length ? keyOf(items[0]!) : '';
    const last = items.length ? keyOf(items[items.length - 1]!) : '';
    const p = prev.current;
    if (p.conv !== conversationId) {
      stick.current = true;
      if (items.length) el.scrollTop = el.scrollHeight;
      else { prev.current = { conv: conversationId, first: '', last: '', height: el.scrollHeight }; return; }
    } else if (first !== p.first && last === p.last && p.first) {
      el.scrollTop += el.scrollHeight - p.height; // se han cargado mensajes antiguos: mantener la posición
    } else if (last !== p.last) {
      const nearBottom = p.height - el.scrollTop - el.clientHeight < 200;
      const lastItem = items[items.length - 1];
      const mine = lastItem?.type === 'message' && lastItem.message.direction !== 'INBOUND';
      if (nearBottom || mine) el.scrollTop = el.scrollHeight;
    }
    prev.current = { conv: conversationId, first, last, height: el.scrollHeight };
  }, [items, conversationId]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 80 && hasMore && !loadingMore) onLoadMore();
  };

  let lastDay = '';
  return (
    <div className="thread" ref={box} onScroll={onScroll} onLoadCapture={() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }} aria-label="Historial de la conversación" role="log">
      {loading && <div className="empty"><Spinner /></div>}
      {hasMore && !loading && (
        <button type="button" className="btn ghost load-older" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? 'Cargando…' : 'Cargar mensajes anteriores'}
        </button>
      )}
      {!loading && items.length === 0 && <div className="empty">Aún no hay mensajes en esta conversación.</div>}
      {items.map((it) => {
        const dk = dayKey(it.at);
        const sep = dk !== lastDay;
        lastDay = dk;
        return (
          <Fragment key={keyOf(it)}>
            {sep && <div className="day">{fmtDayLabel(it.at, now)}</div>}
            {it.type === 'message' ? (
              <MessageBubble message={it.message} onRetry={onRetry} onReply={onReply} />
            ) : (
              <div className="event">{it.event.text} · {fmtShortDateTime(it.at)}</div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

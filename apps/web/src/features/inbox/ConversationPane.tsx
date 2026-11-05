// Columna 3: cabecera de la conversación, historial, compositor y modales de adjuntos y plantilla.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MessageDto, SendMessageDto } from '@gelado/shared';
import { Icon } from '../../components/Icon';
import { MenuItem } from '../../components/Popover';
import { Avatar, LabelChip, Spinner } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { AttachModal } from './AttachModal';
import { Composer } from './Composer';
import { ConversationMenuButton } from './ConversationMenus';
import { Thread } from './Thread';
import { TemplateModal } from './TemplateModal';
import { flattenTimeline, useConversation, useConversationActions, useNow, useRetryMessage, useSendMessage, useTimeline } from './hooks';
import { setFocusedConversation } from './notify';
import { emitFocus } from './realtime';
import { displayLabel, fmtPhone, isWindowOpen, remainingText, waInitials, windowRemainingMs } from './utils';

export function ConversationPane({ id, onBack, infoOpen, onToggleInfo }: { id: string; onBack: () => void; infoOpen: boolean; onToggleInfo: () => void }) {
  const { user } = useAuth();
  const conv = useConversation(id);
  const timeline = useTimeline(id);
  const items = useMemo(() => flattenTimeline(timeline.data), [timeline.data]);
  const act = useConversationActions();
  const now = useNow(30_000);
  const send = useSendMessage(id, user ? { id: user.id, name: user.name } : null);
  const retry = useRetryMessage(id);

  const [attach, setAttach] = useState<File[] | null>(null);
  const [template, setTemplate] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // conversación en foco: no notificar, y leída en WhatsApp al abrir (RF-2.22)
  useEffect(() => {
    setFocusedConversation(id);
    emitFocus(id);
    const onVis = () => emitFocus(document.visibilityState === 'visible' ? id : null);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      setFocusedConversation(null);
      emitFocus(null);
    };
  }, [id]);
  const readFor = useRef<string | null>(null);
  useEffect(() => {
    if (conv.data && readFor.current !== id) {
      readFor.current = id;
      void act.markRead(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.data?.id, id]);
  useEffect(() => { setReplyTo(null); }, [id]);

  const sendOk = useCallback(async (dto: SendMessageDto) => (await send(dto)) != null, [send]);

  if (conv.isLoading) return <main className="chat"><div className="empty"><Spinner /></div></main>;
  if (conv.isError || !conv.data) {
    return (
      <main className="chat">
        <div className="empty">No se ha podido abrir la conversación. <button className="btn" onClick={() => conv.refetch()}>Reintentar</button>
          <button className="btn ghost show-mobile" onClick={onBack}>Volver</button></div>
      </main>
    );
  }
  const c = conv.data;
  const name = displayLabel(c.displayName, c.phoneE164);
  const open = isWindowOpen(c, now);
  const remaining = remainingText(windowRemainingMs(c.windowExpiresAt, now));
  const firstName = c.assignee?.name.split(/\s+/)[0];

  const dropProps = {
    onDragEnter: (e: React.DragEvent) => { if (open && e.dataTransfer.types.includes('Files')) { dragDepth.current++; setDragging(true); } },
    onDragOver: (e: React.DragEvent) => { if (open && e.dataTransfer.types.includes('Files')) e.preventDefault(); },
    onDragLeave: () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDrop: (e: React.DragEvent) => {
      if (!open || !e.dataTransfer.files.length) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      setAttach([...e.dataTransfer.files]);
    },
  };

  return (
    <main className="chat" aria-label={`Conversación con ${name}`} {...dropProps}>
      <header className="chat-head">
        <button className="tbtn show-mobile" aria-label="Volver a la bandeja" onClick={onBack}><Icon name="back" /></button>
        <div className="wa">{waInitials(c.displayName, c.phoneE164)}</div>
        <div className="head-id">
          <div className="name"><span className="trunc">{name}</span>{c.contactLabels.map((l) => <LabelChip key={l.id} label={l} />)}</div>
          <div className="sub">
            <span className="hide-mobile">{fmtPhone(c.phoneE164)} · </span>
            {open ? <span className="window-ok">Ventana abierta: quedan {remaining}</span> : <span className="window-closed">Ventana cerrada: solo plantillas</span>}
          </div>
        </div>
        <div className="head-actions">
          <span className="hide-mobile row" style={{ gap: 6 }}>
            <ConversationMenuButton conv={c} mode="assign" align="right" trigger={
              <button className="hbtn" aria-label="Asignar" aria-haspopup="menu">
                {c.assignee ? <><Avatar small name={c.assignee.name} />{firstName}</> : <><Icon name="userPlus" small />Asignar</>}
              </button>} />
            <ConversationMenuButton conv={c} mode="labels" align="right" trigger={<button className="hbtn" aria-label="Etiquetar" aria-haspopup="menu" title="Etiquetar"><Icon name="tag" small /></button>} />
            <ConversationMenuButton conv={c} mode="snooze" align="right" trigger={<button className="hbtn" aria-label="Posponer" aria-haspopup="menu" title="Posponer"><Icon name="clock" small /></button>} />
          </span>
          {c.status === 'DONE' ? (
            <button className="hbtn" aria-label="Reabrir conversación" onClick={() => void act.reopen(id)}><Icon name="refresh" small /><span className="hide-mobile">Reabrir</span></button>
          ) : (
            <button className="hbtn" aria-label="Marcar como finalizada" onClick={() => void act.done(id)}><Icon name="check" small /><span className="hide-mobile">Finalizar</span></button>
          )}
          <button className={`hbtn hide-mobile${infoOpen ? ' on' : ''}`} aria-label="Ficha del contacto" aria-pressed={infoOpen} onClick={onToggleInfo}><Icon name="user" small />Ficha</button>
          <ConversationMenuButton
            conv={c}
            align="right"
            trigger={<button className="hbtn" aria-label="Más acciones" aria-haspopup="menu"><Icon name="more" small /></button>}
            extra={(close) => <MenuItem icon="user" onClick={() => { onToggleInfo(); close(); }}>{infoOpen ? 'Ocultar ficha' : 'Ver ficha'}</MenuItem>}
          />
        </div>
      </header>

      <Thread
        conversationId={id}
        items={items}
        loading={timeline.isLoading}
        hasMore={!!timeline.hasNextPage}
        loadingMore={timeline.isFetchingNextPage}
        onLoadMore={() => void timeline.fetchNextPage()}
        onRetry={(mid) => void retry(mid)}
        onReply={open ? setReplyTo : undefined}
      />

      <Composer
        key={id}
        conversationId={id}
        windowOpen={open}
        hadInbound={!!c.lastInboundAt}
        send={send}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onAttach={() => setAttach([])}
        onTemplate={() => setTemplate(true)}
      />

      {dragging && <div className="drop-overlay" aria-hidden="true"><Icon name="upload" /> Suelta los archivos para adjuntarlos</div>}
      {attach && (
        <AttachModal
          initialFiles={attach}
          onClose={() => setAttach(null)}
          onSend={(ids, caption) => sendOk({ type: 'media', mediaFileIds: ids, caption: caption || undefined })}
        />
      )}
      {template && <TemplateModal conversation={c} onClose={() => setTemplate(false)} onSend={sendOk} />}
    </main>
  );
}

// Compositor: texto (Enter envía), nota interna, emoji, adjuntar, nota de voz y plantilla. Con la ventana cerrada solo ofrece plantilla.
import { useEffect, useRef, useState } from 'react';
import type { MessageDto, SendMessageDto } from '@gelado/shared';
import { Icon } from '../../components/Icon';
import { Popover } from '../../components/Popover';
import { useToast } from '../../components/ui';
import { inboxApi } from './api';
import { EMOJIS } from './emoji';
import { errMsg } from './hooks';
import { KIND_PREVIEW } from './utils';
import { useVoiceRecorder, voiceSupported } from './voice';

const drafts = new Map<string, { reply: string; note: string }>();
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const coarse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

export function Composer({
  conversationId, windowOpen, hadInbound, send, onAttach, onTemplate, replyTo, onClearReply,
}: {
  conversationId: string;
  windowOpen: boolean;
  hadInbound: boolean;
  send: (dto: SendMessageDto, extra?: { quoted?: MessageDto['quoted'] }) => Promise<MessageDto | null>;
  onAttach: () => void;
  onTemplate: () => void;
  replyTo: MessageDto | null;
  onClearReply: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<'reply' | 'note'>(windowOpen ? 'reply' : 'note');
  const [noteOnly, setNoteOnly] = useState(false);
  const saved = drafts.get(conversationId);
  const [texts, setTexts] = useState({ reply: saved?.reply ?? '', note: saved?.note ?? '' });
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceRecorder();
  const touchHold = useRef(false);
  const text = texts[tab];

  // el borrador se conserva al cambiar de conversación
  const latest = useRef(texts);
  latest.current = texts;
  useEffect(() => () => { drafts.set(conversationId, latest.current); }, [conversationId]);
  // si la ventana se cierra o se abre mientras se escribe
  useEffect(() => { if (!windowOpen) setTab('note'); }, [windowOpen]);
  useEffect(() => { if (replyTo) area.current?.focus(); }, [replyTo]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text, tab]);

  const setText = (v: string) => setTexts((t) => ({ ...t, [tab]: v }));

  async function submit() {
    const body = text.trim();
    if (!body || sending) return;
    const isNote = tab === 'note';
    setText('');
    const dto: SendMessageDto = isNote ? { type: 'note', body } : { type: 'text', body, replyToMessageId: replyTo?.id };
    const quoted = replyTo && !isNote ? { id: replyTo.id, body: replyTo.body, kind: replyTo.kind, direction: replyTo.direction } : null;
    if (!isNote) onClearReply();
    const ok = await send(dto, { quoted });
    if (!ok) setText(body);
    area.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !coarse()) {
      e.preventDefault();
      void submit();
    }
  }

  function insertEmoji(emoji: string) {
    const el = area.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  async function startRec() {
    try {
      await voice.start();
    } catch (e) {
      toast(e instanceof Error && /Permission|NotAllowed|denied/i.test(e.name + e.message) ? 'No se ha permitido el acceso al micrófono' : errMsg(e, 'No se ha podido grabar'), true);
    }
  }
  async function finishRec() {
    const file = await voice.stop();
    if (!file) return;
    setSending(true);
    try {
      const media = await inboxApi.uploadMedia(file, file.name);
      await send({ type: 'media', mediaFileIds: [media.id], voice: true });
    } catch (e) {
      toast(errMsg(e, 'No se ha podido enviar la nota de voz'), true);
    } finally {
      setSending(false);
    }
  }

  // ── Ventana cerrada: solo plantillas ──
  if (!windowOpen && !noteOnly) {
    return (
      <div className="composer closed" aria-label="Ventana de 24 h cerrada">
        <Icon name="clock" />
        <div className="grow">
          <div className="closed-title">{hadInbound ? 'Han pasado más de 24 h desde el último mensaje del cliente' : 'Este cliente todavía no te ha escrito'}</div>
          <div className="hint">WhatsApp solo deja escribir primero con una plantilla aprobada.</div>
        </div>
        <button type="button" className="btn ghost" onClick={() => { setNoteOnly(true); setTab('note'); }}>Nota interna</button>
        <button type="button" className="send" onClick={onTemplate}>Enviar plantilla</button>
      </div>
    );
  }

  const isNote = tab === 'note';
  const recBar = voice.recording && (
    <div className="rec-bar" role="status">
      <span className="rec-dot" /> <strong>Grabando</strong> <span className="mono">{mmss(voice.seconds)}</span>
      <span className="grow" />
      <button type="button" className="btn" onClick={() => voice.cancel()}><Icon name="trash" small /> Cancelar</button>
      <button type="button" className="btn primary" onClick={() => void finishRec()}><Icon name="send" small /> Enviar</button>
    </div>
  );

  return (
    <div className={`composer${isNote ? ' is-note' : ''}`} data-empty={text.trim() ? undefined : 'true'}>
      <div className="ctabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'reply'} className={`ctab${tab === 'reply' ? ' on' : ''}`} disabled={!windowOpen} onClick={() => setTab('reply')}>Responder</button>
        <button type="button" role="tab" aria-selected={tab === 'note'} className={`ctab${tab === 'note' ? ' note-on' : ''}`} onClick={() => setTab('note')}>Nota interna</button>
        {!windowOpen && <button type="button" className="ctab right" onClick={() => setNoteOnly(false)}>Volver</button>}
      </div>
      {replyTo && tab === 'reply' && (
        <div className="reply-bar">
          <div className="quote grow"><strong>{replyTo.direction === 'INBOUND' ? 'Cliente' : replyTo.sentBy?.name ?? 'Equipo'}</strong> · {replyTo.body?.slice(0, 120) ?? KIND_PREVIEW[replyTo.kind] ?? 'Mensaje'}</div>
          <button type="button" className="tbtn" aria-label="Cancelar respuesta" onClick={onClearReply}><Icon name="close" small /></button>
        </div>
      )}
      {recBar || (
        <div className="cbody">
          <textarea
            ref={area}
            className={`cbox${isNote ? ' note' : ''}`}
            rows={1}
            value={text}
            aria-label={isNote ? 'Nota interna' : 'Escribe un mensaje'}
            placeholder={isNote ? 'Escribe una nota interna (solo la ve el equipo)…' : (window.innerWidth <= 760 ? 'Mensaje' : 'Escribe un mensaje… (Enter para enviar, Mayús + Enter para salto de línea)')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="ctools">
            <Popover
              label="Emoji"
              minWidth={288}
              className="hide-mobile"
              trigger={<button type="button" className="tbtn t-left" aria-label="Emoji" aria-haspopup="menu"><Icon name="smile" /></button>}
            >
              {(close) => (
                <div className="emoji-grid">
                  {EMOJIS.map((e) => <button key={e} type="button" aria-label={`Emoji ${e}`} onClick={() => { insertEmoji(e); close(); }}>{e}</button>)}
                </div>
              )}
            </Popover>
            {!isNote && (
              <>
                <button type="button" className="tbtn t-left" aria-label="Adjuntar archivo" title="Adjuntar archivo" onClick={onAttach}><Icon name="clip" /></button>
                <button type="button" className="tbtn t-left" aria-label="Enviar plantilla de WhatsApp" title="Enviar plantilla de WhatsApp" onClick={onTemplate}><Icon name="bookmark" /></button>
                {voiceSupported() && (
                  <button
                    type="button"
                    className="tbtn mic-small"
                    aria-label="Grabar nota de voz"
                    title="Grabar nota de voz"
                    onClick={() => { if (touchHold.current) { touchHold.current = false; return; } void startRec(); }}
                  ><Icon name="mic" /></button>
                )}
              </>
            )}
            {!isNote && voiceSupported() && (
              <button
                type="button"
                className="play mic-big"
                aria-label="Mantén pulsado para grabar nota de voz"
                onPointerDown={(e) => { if (e.pointerType === 'touch') { touchHold.current = true; void startRec(); } }}
                onPointerUp={(e) => { if (e.pointerType === 'touch' && voice.recording) void finishRec(); }}
                onPointerCancel={() => { if (voice.recording) voice.cancel(); }}
                onContextMenu={(e) => e.preventDefault()}
              ><Icon name="mic" /></button>
            )}
            <button type="button" className="send" disabled={!text.trim() || sending} onClick={() => void submit()}>
              {isNote ? 'Añadir nota' : 'Enviar'} <Icon name="send" small />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Burbuja de mensaje: texto con formato WhatsApp, adjuntos, citas, reacciones, estados y errores.
import { useState } from 'react';
import type { MessageDto } from '@gelado/shared';
import { Icon } from '../../components/Icon';
import { Lightbox } from '../../components/Lightbox';
import { AudioPlayer } from '../../components/AudioPlayer';
import { Spinner } from '../../components/ui';
import { fmtBytes, fmtTime } from '../../lib/format';
import { WhatsAppText } from './whatsappFormat';
import { KIND_PREVIEW, fileExt, mapsUrl } from './utils';

function Ticks({ status }: { status: MessageDto['status'] }) {
  if (status === 'PENDING') return <span className="tk" role="img" aria-label="Enviando"><Icon name="clock" small /></span>;
  if (status === 'SENT') return <span className="tk" role="img" aria-label="Enviado">✓</span>;
  if (status === 'DELIVERED') return <span className="tk" role="img" aria-label="Entregado">✓✓</span>;
  if (status === 'READ') return <span className="ticks" role="img" aria-label="Leído">✓✓</span>;
  return null;
}

function contactsOf(payload: unknown): { name: string; phone?: string }[] {
  const arr: any[] = Array.isArray(payload) ? payload : Array.isArray((payload as any)?.contacts) ? (payload as any).contacts : [];
  return arr.map((c) => ({
    name: c?.name?.formatted_name ?? [c?.name?.first_name, c?.name?.last_name].filter(Boolean).join(' ') ?? 'Contacto',
    phone: c?.phones?.[0]?.phone ?? c?.phones?.[0]?.wa_id,
  }));
}
function buttonsOf(payload: unknown): string[] {
  const b = (payload as any)?.buttons;
  return Array.isArray(b) ? b.map((x: any) => (typeof x === 'string' ? x : x?.text)).filter(Boolean) : [];
}

function MediaBlock({ m }: { m: MessageDto }) {
  const [zoom, setZoom] = useState(false);
  const media = m.media;
  if (m.kind === 'LOCATION') {
    const p = (m.payload ?? {}) as { latitude?: number; longitude?: number; name?: string; address?: string; url?: string };
    const url = p.latitude != null && p.longitude != null ? mapsUrl(p.latitude, p.longitude) : p.url;
    return (
      <div className="att loc">
        <div className="loc-ic"><Icon name="map" /></div>
        <div style={{ minWidth: 0 }}>
          <div className="fn">{p.name ?? 'Ubicación'}</div>
          {p.address && <div className="fs">{p.address}</div>}
          {url && <a href={url} target="_blank" rel="noopener noreferrer" className="fs">Ver en el mapa</a>}
        </div>
      </div>
    );
  }
  if (m.kind === 'CONTACTS') {
    return (
      <>
        {contactsOf(m.payload).map((c, i) => (
          <div className="att" key={i}>
            <div className="loc-ic"><Icon name="user" /></div>
            <div><div className="fn">{c.name}</div>{c.phone && <div className="fs">{c.phone}</div>}</div>
          </div>
        ))}
      </>
    );
  }
  if (m.kind === 'UNSUPPORTED') {
    const t = (m.payload as any)?.type ?? m.body ?? 'desconocido';
    return <div className="unsupported"><Icon name="info" small /> Tipo de mensaje no soportado: {String(t)}</div>;
  }
  if (m.kind === 'REACTION') {
    return <div className="hint">Ha reaccionado con {(m.payload as any)?.emoji ?? m.body ?? '👍'}</div>;
  }
  if (!media) return null;
  const waiting = !!media.pending;
  if (waiting) {
    return <div className="photo pending"><Spinner /> Descargando adjunto…</div>;
  }
  switch (m.kind) {
    case 'IMAGE':
      if (!media.url) return <div className="photo">Imagen no disponible</div>;
      return (
        <>
          <button type="button" className="photo-btn" aria-label="Ampliar imagen" onClick={() => setZoom(true)}>
            <img src={media.url} alt={media.fileName ?? 'Imagen'} loading="lazy" />
          </button>
          {zoom && <Lightbox src={media.url} alt={media.fileName ?? undefined} downloadName={media.fileName} onClose={() => setZoom(false)} />}
        </>
      );
    case 'STICKER':
      return media.url ? <img className="sticker-img" src={media.url} alt="Sticker" /> : <div className="photo">Sticker</div>;
    case 'VIDEO':
      return media.url ? <video className="video" src={media.url} controls preload="metadata" /> : <div className="photo">Vídeo no disponible</div>;
    case 'AUDIO':
    case 'VOICE':
      return media.url ? <AudioPlayer src={media.url} seed={media.id} label={m.kind === 'VOICE' ? 'nota de voz' : 'audio'} /> : <div className="hint">Audio no disponible</div>;
    default:
      return (
        <div className="att">
          <div className="pdf">{fileExt(media.fileName, media.mimeType).slice(0, 4)}</div>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="fn trunc">{media.fileName ?? 'Documento'}</div>
            <div className="fs">{fmtBytes(media.sizeBytes)}</div>
          </div>
          {media.url && (
            <a className="tbtn" href={media.url} download={media.fileName ?? true} target="_blank" rel="noopener noreferrer" aria-label={`Descargar ${media.fileName ?? 'documento'}`}>
              <Icon name="download" small />
            </a>
          )}
        </div>
      );
  }
}

export function messageAuthorLine(m: MessageDto): string | null {
  if (m.kind === 'NOTE' || m.direction === 'INTERNAL') return `Nota interna${m.sentBy ? ` · ${m.sentBy.name}` : ''}`;
  if (m.kind === 'AUTO_REPLY') return 'Respuesta automática';
  if (m.campaignName) return `Campaña · ${m.campaignName}`;
  if (m.direction === 'OUTBOUND') {
    const parts = [m.sentBy?.name, m.kind === 'TEMPLATE' ? 'Plantilla' : null].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }
  return null;
}

export function MessageBubble({ message: m, onRetry, onReply }: { message: MessageDto; onRetry?: (id: string) => void; onReply?: (m: MessageDto) => void }) {
  const failed = m.status === 'FAILED';
  const cls = m.direction === 'INTERNAL' || m.kind === 'NOTE' ? 'note' : m.direction === 'INBOUND' ? 'in' : 'out';
  const by = messageAuthorLine(m);
  const buttons = m.kind === 'TEMPLATE' || m.kind === 'AUTO_REPLY' ? buttonsOf(m.payload) : [];
  const showBody = !!m.body && m.kind !== 'UNSUPPORTED' && m.kind !== 'REACTION';
  const canReply = !!onReply && cls !== 'note' && !failed && !m.id.startsWith('tmp-');
  return (
    <>
      <div className={`msg ${cls}${failed ? ' failed' : ''}${m.kind === 'STICKER' ? ' sticker' : ''}`} data-kind={m.kind} data-status={m.status} id={`msg-${m.id}`}>
        {by && <div className="by">{by}</div>}
        {m.quoted && (
          <div className="quote">
            {m.quoted.body ? m.quoted.body.slice(0, 140) : KIND_PREVIEW[m.quoted.kind] ?? 'Mensaje'}
          </div>
        )}
        <MediaBlock m={m} />
        {showBody && (
          <div className={m.media || m.kind === 'LOCATION' ? 'msg-text spaced' : 'msg-text'}>
            {m.kind === 'BUTTON_REPLY' && <Icon name="reply" small />} <WhatsAppText text={m.body!} />
          </div>
        )}
        {m.reactions.length > 0 && (
          <div className="reacts" aria-label="Reacciones">
            {m.reactions.map((r, i) => <span key={i} title={r.direction === 'INBOUND' ? 'Reacción del cliente' : 'Reacción del equipo'}>{r.emoji}</span>)}
          </div>
        )}
        {failed && (
          <div className="fail-reason" role="alert">
            <Icon name="warn" small />
            <span className="grow">{m.errorTitle ?? 'No se ha podido enviar el mensaje'}</span>
            {m.retryable && onRetry && <button type="button" className="btn retry" onClick={() => onRetry(m.id)}>Reintentar</button>}
          </div>
        )}
        <div className="foot">
          {fmtTime(m.createdAt)} {m.direction === 'OUTBOUND' && !failed && <Ticks status={m.status} />}
          {failed && <span className="bad-text">No enviado</span>}
        </div>
        {canReply && (
          <button type="button" className="msg-reply" aria-label="Responder a este mensaje" title="Responder" onClick={() => onReply!(m)}>
            <Icon name="reply" small />
          </button>
        )}
      </div>
      {buttons.length > 0 && (
        <div className="qr" aria-label="Botones de la plantilla">
          {buttons.map((b) => <div className="b" key={b}>{b}</div>)}
        </div>
      )}
    </>
  );
}

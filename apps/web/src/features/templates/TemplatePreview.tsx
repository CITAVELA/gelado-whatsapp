// CONTRATO (dueño: S3 · Plantillas). Vista previa tipo WhatsApp de una plantilla, con variables rellenadas.
// La usan el editor (S3), el modal de plantilla del chat (S4) y el asistente de campañas (S6).
import { Fragment, type ReactNode } from 'react';
import type { TemplateComponent } from '@gelado/shared';
import './templates.css';

export interface TemplatePreviewProps {
  components: TemplateComponent[];
  /** valores por clave de variable: { "body.1": "Ginés", "header.1": "…" } */
  values?: Record<string, string>;
  /** URL de la cabecera multimedia (imagen/vídeo/documento) si la hay */
  headerMediaUrl?: string | null;
}

// Marcas privadas para las variables que aún no tienen valor (se resaltan como {{n}}).
const VAR_OPEN = '';
const VAR_CLOSE = '';
const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;

/** Sustituye `{{n}}` por `values[prefix.n]`; si falta, deja una marca para resaltarla. */
export function fillVariables(text: string, prefix: string, values: Record<string, string> = {}): string {
  return text.replace(VAR_RE, (_, n: string) => {
    const v = values[`${prefix}.${n}`];
    return v != null && v !== '' ? v : `${VAR_OPEN}${n}${VAR_CLOSE}`;
  });
}

function leaf(text: string, key: string): ReactNode {
  if (!text.includes(VAR_OPEN)) return text;
  const parts = text.split(new RegExp(`${VAR_OPEN}(\\d+)${VAR_CLOSE}`));
  return (
    <Fragment key={key}>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i} className="wa-var">{`{{${p}}}`}</mark> : p))}
    </Fragment>
  );
}

// Los marcadores solo valen al inicio/fin de palabra y sin espacio pegado al marcador (como WhatsApp).
const B = '(?<![\\p{L}\\p{N}])';
const A = '(?![\\p{L}\\p{N}])';
const FORMAT_RE = new RegExp(
  [
    '```([\\s\\S]+?)```', // 1 monoespaciado
    `${B}\\*(?!\\s)([^*\\n]*?[^\\s*])\\*${A}`, // 2 negrita
    `${B}_(?!\\s)([^_\\n]*?[^\\s_])_${A}`, // 3 cursiva
    `${B}~(?!\\s)([^~\\n]*?[^\\s~])~${A}`, // 4 tachado
  ].join('|'),
  'u',
);

/**
 * Convierte texto con formato de WhatsApp (*negrita*, _cursiva_, ~tachado~, ```mono```) en nodos React.
 * Pura y sin HTML crudo (no hay riesgo de inyección). Admite anidar (*_así_*).
 */
export function renderWhatsAppFormatting(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest) {
    const m = FORMAT_RE.exec(rest);
    if (!m) {
      out.push(leaf(rest, `t${k++}`));
      break;
    }
    if (m.index > 0) out.push(leaf(rest.slice(0, m.index), `t${k++}`));
    const key = `f${k++}`;
    if (m[1] != null) out.push(<code key={key}>{leaf(m[1], key)}</code>);
    else if (m[2] != null) out.push(<strong key={key}>{renderWhatsAppFormatting(m[2])}</strong>);
    else if (m[3] != null) out.push(<em key={key}>{renderWhatsAppFormatting(m[3])}</em>);
    else out.push(<s key={key}>{renderWhatsAppFormatting(m[4]!)}</s>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const MEDIA_LABEL: Record<string, string> = { IMAGE: 'Imagen de cabecera', VIDEO: 'Vídeo de cabecera', DOCUMENT: 'Documento de cabecera' };

function HeaderMedia({ format, url }: { format: string; url?: string | null }) {
  if (format === 'IMAGE' && url) return <img className="wa-media" src={url} alt="Cabecera de la plantilla" />;
  if (format === 'VIDEO' && url) return <video className="wa-media" src={url} muted controls={false} />;
  if (format === 'DOCUMENT') return <div className="wa-doc"><span aria-hidden="true">📄</span> {url ? 'Documento adjunto' : MEDIA_LABEL.DOCUMENT}</div>;
  return (
    <div className="photo wa-media" role="img" aria-label={MEDIA_LABEL[format] ?? 'Cabecera'}>
      {MEDIA_LABEL[format] ?? 'Cabecera'}
    </div>
  );
}

const BTN_GLYPH: Record<string, string> = { URL: '↗', PHONE_NUMBER: '✆', QUICK_REPLY: '↩', COPY_CODE: '⧉', FLOW: '▤' };

export function TemplatePreview({ components, values = {}, headerMediaUrl }: TemplatePreviewProps) {
  const header = components.find((c) => c.type === 'HEADER');
  const body = components.find((c) => c.type === 'BODY');
  const footer = components.find((c) => c.type === 'FOOTER');
  const buttons = components.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
  const isMedia = header?.format === 'IMAGE' || header?.format === 'VIDEO' || header?.format === 'DOCUMENT';

  return (
    <div className="wa-prev" data-testid="template-preview">
      {isMedia && <HeaderMedia format={header!.format!} url={headerMediaUrl} />}
      <div className="wa-bub">
        {header?.format === 'TEXT' && header.text && <div className="wa-head">{renderWhatsAppFormatting(fillVariables(header.text, 'header', values))}</div>}
        {body?.text ? <div className="wa-body">{renderWhatsAppFormatting(fillVariables(body.text, 'body', values))}</div> : <span className="wa-empty">Escribe el mensaje…</span>}
        {footer?.text && <div className="wa-foot">{footer.text}</div>}
      </div>
      {buttons.map((b, i) => (
        <div key={i} className="wa-btn">
          <span aria-hidden="true" className="wa-btn-ic">{BTN_GLYPH[b.type] ?? ''}</span> {b.text}
        </div>
      ))}
    </div>
  );
}

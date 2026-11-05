// «Enviar plantilla de WhatsApp a …»: plantillas aprobadas, variables, cabecera multimedia, coste estimado y vista previa (RF-2.10).
import { useMemo, useRef, useState } from 'react';
import type { ConversationDetailDto, LibraryFileDto, SendMessageDto, TemplateDto } from '@gelado/shared';
import { LABELS_ES } from '@gelado/shared';
import { Icon } from '../../components/Icon';
import { SearchInput } from '../../components/SearchInput';
import { Modal, Spinner } from '../../components/ui';
import { TemplatePreview } from '../templates/TemplatePreview';
import { inboxApi } from './api';
import { errMsg, useApprovedTemplates, useRates } from './hooks';
import { LibraryPicker } from './LibraryPicker';
import { displayLabel, fmtRate, isPhoneLike } from './utils';

interface HeaderMedia { id: string; name: string; url: string | null }

const HEADER_MIME: Record<string, string> = { IMAGE: 'image/', VIDEO: 'video/', DOCUMENT: 'application/' };

/** Valores iniciales con datos del contacto: la primera variable del cuerpo suele ser el nombre. */
export function prefillVariables(t: TemplateDto, c: ConversationDetailDto['contact']): { values: Record<string, string>; prefilled: Set<string> } {
  const values: Record<string, string> = {};
  const prefilled = new Set<string>();
  const first = c.firstName?.trim() || (c.displayName && !isPhoneLike(c.displayName) ? c.displayName.split(/\s+/)[0] : '') || '';
  for (const k of t.variables) {
    values[k] = '';
    if ((k === 'body.1' || k === 'header.1') && first) {
      values[k] = first;
      prefilled.add(k);
    }
  }
  return { values, prefilled };
}

function variableLabel(k: string, t: TemplateDto): { label: string; example?: string } {
  const [part, n] = k.split('.');
  const idx = Number(n);
  if (part === 'body') {
    const body = t.components.find((c) => c.type === 'BODY');
    return { label: `Variable ${idx}`, example: body?.example?.body_text?.[0]?.[idx - 1] };
  }
  if (part === 'header') return { label: 'Variable de la cabecera' };
  return { label: `Botón ${idx + 1} · final del enlace` };
}

export function TemplateModal({ conversation, onSend, onClose }: { conversation: ConversationDetailDto; onSend: (dto: SendMessageDto) => Promise<boolean>; onClose: () => void }) {
  const templates = useApprovedTemplates();
  const rates = useRates();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<TemplateDto | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [prefilled, setPrefilled] = useState<Set<string>>(new Set());
  const [header, setHeader] = useState<HeaderMedia | null>(null);
  const [pickHeader, setPickHeader] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);

  const name = displayLabel(conversation.displayName, conversation.phoneE164);
  const list = useMemo(() => (templates.data ?? []).filter((t) => (t.displayName ?? t.name).toLowerCase().includes(q.trim().toLowerCase())), [templates.data, q]);

  const choose = (t: TemplateDto) => {
    setSel(t);
    const p = prefillVariables(t, conversation.contact);
    setValues(p.values);
    setPrefilled(p.prefilled);
    setHeader(null);
    setError(null);
  };

  const needsHeader = !!sel && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(sel.headerFormat);
  const optedOut = !!sel && sel.category === 'MARKETING' && conversation.contact.consentStatus === 'REVOKED';
  const missing = !!sel && sel.variables.some((k) => !values[k]?.trim());
  const canSend = !!sel && !missing && (!needsHeader || !!header) && !optedOut && !busy;
  const rate = sel && rates.data ? (sel.category === 'MARKETING' ? rates.data.marketing : sel.category === 'UTILITY' ? rates.data.utility : rates.data.authentication) : null;

  async function submit() {
    if (!sel) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await onSend({ type: 'template', templateId: sel.id, params: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])), headerMediaFileId: header?.id });
      if (ok) onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function onHeaderFile(file: File) {
    setError(null);
    try {
      const m = await inboxApi.uploadMedia(file, file.name);
      setHeader({ id: m.id, name: file.name, url: m.url });
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Modal
      title={`Enviar plantilla de WhatsApp a ${name}`}
      width={1080}
      height={640}
      bare
      onClose={onClose}
      footer={<>
        {error && <span className="err grow">{error}</span>}
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!canSend} onClick={() => void submit()}>{busy ? 'Enviando…' : 'Enviar plantilla'}</button>
      </>}
    >
      <div className="tpl-grid">
        <div className="tpl-list">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar plantilla…" label="Buscar plantilla" />
          <div className="sect" style={{ marginLeft: 4 }}>Aprobadas</div>
          {templates.isLoading && <div className="empty"><Spinner /></div>}
          {list.map((t) => (
            <button key={t.id} type="button" className={`mi tpl-item${sel?.id === t.id ? ' on' : ''}`} aria-pressed={sel?.id === t.id} onClick={() => choose(t)}>
              <span className="b">{t.displayName ?? t.name}</span>
              <span className="hint">{LABELS_ES.templateCategory[t.category]} · {t.language === 'es' ? 'español' : t.language}</span>
            </button>
          ))}
          {!templates.isLoading && list.length === 0 && <div className="hint" style={{ padding: 8 }}>No hay plantillas aprobadas{q ? ' con ese nombre' : ''}.</div>}
        </div>

        <div className="tpl-form">
          {!sel && <div className="empty">Elige una plantilla de la lista.</div>}
          {sel && sel.variables.length === 0 && !needsHeader && <div className="hint">Esta plantilla no tiene variables: se envía tal cual.</div>}
          {sel?.variables.map((k) => {
            const { label, example } = variableLabel(k, sel);
            return (
              <label key={k}>
                <span className="label">{label}</span>
                <input className="field" value={values[k] ?? ''} placeholder={example ? `Ej.: ${example}` : 'Escribe el texto…'} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
                {prefilled.has(k) && <span className="hint">del campo Nombre del contacto</span>}
              </label>
            );
          })}
          {needsHeader && sel && (
            <div>
              <span className="label">Cabecera: {sel.headerFormat === 'IMAGE' ? 'imagen' : sel.headerFormat === 'VIDEO' ? 'vídeo' : 'documento'}</span>
              {header ? (
                <div className="att"><div className="pdf">{sel.headerFormat === 'IMAGE' ? 'IMG' : sel.headerFormat === 'VIDEO' ? 'VÍD' : 'DOC'}</div><div className="grow fn trunc">{header.name}</div>
                  <button type="button" className="tbtn" aria-label="Quitar archivo de la cabecera" onClick={() => setHeader(null)}><Icon name="close" small /></button></div>
              ) : (
                <div className="row">
                  <button type="button" className="btn" onClick={() => setPickHeader(true)}><Icon name="folder" small /> De la biblioteca</button>
                  <button type="button" className="btn" onClick={() => upload.current?.click()}><Icon name="upload" small /> Subir archivo</button>
                  <input ref={upload} type="file" hidden aria-label="Subir archivo de la cabecera" accept={HEADER_MIME[sel.headerFormat] ? `${HEADER_MIME[sel.headerFormat]}*` : undefined} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onHeaderFile(f); e.target.value = ''; }} />
                </div>
              )}
            </div>
          )}
          {optedOut && (
            <div className="notice bad" role="alert">Este contacto se ha dado de baja de la publicidad: no se le pueden enviar plantillas de marketing. Elige una plantilla de utilidad.</div>
          )}
          {sel && rate != null && (
            <div className="notice">
              Coste estimado de este envío: <b>{fmtRate(rate)}</b> (plantilla de {sel.category === 'MARKETING' ? 'marketing' : sel.category === 'UTILITY' ? 'utilidad' : 'autenticación'}).
              Cuando el cliente conteste, podréis escribir libremente durante 24 h.
            </div>
          )}
        </div>

        <div className="tpl-prev">
          <span className="label">Vista previa</span>
          {sel ? <TemplatePreview components={sel.components} values={values} headerMediaUrl={header?.url ?? null} /> : <div className="hint">Aquí verás cómo le llegará el mensaje.</div>}
        </div>
      </div>

      {pickHeader && sel && (
        <HeaderPicker
          kind={sel.headerFormat}
          onClose={() => setPickHeader(false)}
          onPick={(f) => { setHeader({ id: f.media.id, name: f.name, url: f.media.url }); setPickHeader(false); }}
        />
      )}
    </Modal>
  );
}

function HeaderPicker({ kind, onPick, onClose }: { kind: string; onPick: (f: LibraryFileDto) => void; onClose: () => void }) {
  const prefix = HEADER_MIME[kind] ?? '';
  const [chosen, setChosen] = useState<Map<string, LibraryFileDto>>(new Map());
  return (
    <Modal title="Elegir archivo de la biblioteca" width={720} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={chosen.size === 0} onClick={() => onPick([...chosen.values()][0]!)}>Usar archivo</button>
    </>}>
      <LibraryPicker selected={chosen} accept={(f) => !prefix || f.media.mimeType.startsWith(prefix)} onToggle={(f) => setChosen(new Map([[f.id, f]]))} />
    </Modal>
  );
}

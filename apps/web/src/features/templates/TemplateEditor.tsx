import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  OPT_OUT_BUTTON_TEXT,
  TEMPLATE_LIMITS,
  editorToComponents,
  extractVariables,
  slugifyTemplateName,
  templateDraftSchema,
  templateEditorSchema,
  validateTemplateEditor,
  type TemplateDraftDto,
  type TemplateDto,
  type TemplateEditorDto,
} from '@gelado/shared';
import { api } from '../../lib/api';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/ui';
import { TemplatePreview } from './TemplatePreview';
import { invalidateTemplates } from './queries';

/**
 * Contenido inicial del editor: la respuesta de POST /api/templates/:id/duplicate (llega por `location.state`)
 * o el borrador guardado que se reabre desde el listado (`TemplateDraftPage`).
 */
export interface DraftState {
  sourceTemplateId: string;
  draft: TemplateDraftDto;
  notes: string[];
}

export interface TemplateEditorProps {
  /** Contenido con el que se abre el editor (por defecto, el de `location.state`). */
  initial?: DraftState | null;
  /** Id del borrador local que se está editando: «Guardar borrador» lo actualiza y «Enviar a revisión» lo envía. */
  draftId?: string;
}

const messagesOf = (e: unknown): string[] => {
  const body = (e as { body?: { details?: Array<{ message: string }> } }).body;
  const list = Array.isArray(body?.details) ? body!.details.map((x) => x.message).filter(Boolean) : [];
  return list.length ? list : [(e as Error).message];
};

type HeaderFormat = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
type BtnType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
interface BtnState { type: BtnType; text: string; url: string; example: string; phone: string }

const HEADER_LABEL: Record<HeaderFormat, string> = { NONE: 'Ninguna', TEXT: 'Texto', IMAGE: 'Imagen', VIDEO: 'Vídeo', DOCUMENT: 'Documento' };
const ACCEPT: Record<string, string> = { IMAGE: 'image/jpeg,image/png', VIDEO: 'video/mp4', DOCUMENT: 'application/pdf' };
const BTN_LABEL: Record<BtnType, string> = { QUICK_REPLY: 'Respuesta rápida', URL: 'Enlace', PHONE_NUMBER: 'Llamada' };

const uniqVars = (t: string) => [...new Set(extractVariables(t))].sort((a, b) => a - b);

function Counter({ n, max }: { n: number; max: number }) {
  return <div className={`tpl-counter${n > max ? ' over' : ''}`}>{n} / {max}</div>;
}

export function TemplateEditor({ initial, draftId: initialDraftId }: TemplateEditorProps = {}) {
  const nav = useNavigate();
  const toast = useToast();
  const { state: locState } = useLocation() as { state: DraftState | null };
  const state = initial ?? locState;
  const d = state?.draft;
  const [draftId, setDraftId] = useState<string | undefined>(initialDraftId);

  const [displayName, setDisplayName] = useState(d?.displayName ?? '');
  const [name, setName] = useState(d?.name ?? '');
  const [nameTouched, setNameTouched] = useState(!!d?.name);
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY'>(d?.category ?? 'MARKETING');
  const [language, setLanguage] = useState(d?.language ?? 'es');
  const [headerFormat, setHeaderFormat] = useState<HeaderFormat>(d?.header.format ?? 'NONE');
  const [headerText, setHeaderText] = useState(d?.header.text ?? '');
  const [headerExample, setHeaderExample] = useState(d?.header.textExample ?? '');
  const [media, setMedia] = useState<{ id: string; fileName: string; url: string } | null>(
    d?.header.exampleMediaFileId ? { id: d.header.exampleMediaFileId, fileName: 'archivo guardado en el borrador', url: '' } : null,
  );
  const [uploading, setUploading] = useState(false);
  const [body, setBody] = useState(d?.body ?? '');
  const [examples, setExamples] = useState<string[]>(d?.bodyExamples ?? []);
  const [footer, setFooter] = useState(d?.footer ?? '');
  const [buttons, setButtons] = useState<BtnState[]>(
    (d?.buttons ?? []).map((b) => ({ type: b.type, text: b.text, url: b.type === 'URL' ? b.url ?? '' : '', example: b.type === 'URL' ? b.example ?? '' : '', phone: b.type === 'PHONE_NUMBER' ? b.phone ?? '' : '' })),
  );
  const [optOut, setOptOut] = useState(d?.addOptOutButton ?? true);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // al reabrir un borrador con imagen/vídeo/documento de ejemplo, recupera su vista previa (URL firmada)
  const restoredMediaId = useRef(d?.header.exampleMediaFileId);
  useEffect(() => {
    const id = restoredMediaId.current;
    if (!id) return;
    let alive = true;
    api
      .get<{ url: string }>(`/api/media/${id}/url`)
      .then((r) => alive && setMedia((m) => (m && m.id === id ? { ...m, url: r.url } : m)))
      .catch(() => alive && setMedia((m) => (m && m.id === id ? null : m)));
    return () => {
      alive = false;
    };
  }, []);

  const marketing = category === 'MARKETING';
  const bodyVars = uniqVars(body);

  const dto = useMemo<TemplateEditorDto>(
    () => ({
      displayName: displayName.trim(),
      name,
      category,
      language,
      header: {
        format: headerFormat,
        text: headerFormat === 'TEXT' ? headerText : undefined,
        textExample: headerFormat === 'TEXT' && extractVariables(headerText).length ? headerExample : undefined,
        exampleMediaFileId: headerFormat === 'IMAGE' || headerFormat === 'VIDEO' || headerFormat === 'DOCUMENT' ? media?.id : undefined,
      },
      body,
      bodyExamples: bodyVars.map((_, i) => examples[i] ?? ''),
      footer: footer.trim() || undefined,
      buttons: buttons.map((b) =>
        b.type === 'QUICK_REPLY' ? { type: 'QUICK_REPLY' as const, text: b.text }
        : b.type === 'URL' ? { type: 'URL' as const, text: b.text, url: b.url, example: b.example || undefined }
        : { type: 'PHONE_NUMBER' as const, text: b.text, phone: b.phone },
      ),
      addOptOutButton: marketing ? true : optOut,
    }),
    [displayName, name, category, language, headerFormat, headerText, headerExample, media, body, examples, footer, buttons, optOut, marketing, bodyVars.length],
  );

  const previewComponents = useMemo(() => editorToComponents(dto), [dto]);
  const previewValues = useMemo(() => {
    const v: Record<string, string> = {};
    bodyVars.forEach((n, i) => { if (examples[i]?.trim()) v[`body.${n}`] = examples[i]!; });
    if (headerExample.trim()) v['header.1'] = headerExample;
    return v;
  }, [bodyVars.join(','), examples, headerExample]);

  function onDisplayName(v: string) {
    setDisplayName(v);
    if (!nameTouched) setName(slugifyTemplateName(v));
  }

  function format(marker: string) {
    const el = bodyRef.current;
    if (!el) return;
    const [s, e] = [el.selectionStart, el.selectionEnd];
    const sel = body.slice(s, e);
    const next = body.slice(0, s) + marker + sel + marker + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + marker.length, e + marker.length);
    });
  }

  function addVariable() {
    const n = (bodyVars.at(-1) ?? 0) + 1;
    const el = bodyRef.current;
    const pos = el?.selectionStart ?? body.length;
    const tag = `{{${n}}}`;
    setBody(body.slice(0, pos) + tag + body.slice(el?.selectionEnd ?? pos));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + tag.length, pos + tag.length);
    });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.upload<{ id: string }>('/api/media', fd);
      if (media) URL.revokeObjectURL(media.url);
      setMedia({ id: r.id, fileName: file.name, url: URL.createObjectURL(file) });
    } catch (e) {
      toast(`No se pudo subir el archivo: ${(e as Error).message}`, true);
    } finally {
      setUploading(false);
    }
  }

  function setFormat(f: HeaderFormat) {
    setHeaderFormat(f);
    if (f !== headerFormat) setMedia(null);
  }

  function patchBtn(i: number, p: Partial<BtnState>) {
    setButtons((bs) => bs.map((b, j) => (j === i ? { ...b, ...p } : b)));
  }

  async function submit() {
    setErrors([]);
    const parsed = templateEditorSchema.safeParse(dto);
    const errs = parsed.success ? validateTemplateEditor(parsed.data) : [...new Set(parsed.error.issues.map((i) => i.message))];
    if (errs.length) return setErrors(errs);
    setBusy(true);
    try {
      // un borrador guardado se envía con su mismo registro; si Meta falla sigue siendo borrador
      const t = draftId ? await api.post<TemplateDto>(`/api/templates/${draftId}/submit`, parsed.data) : await api.post<TemplateDto>('/api/templates', parsed.data);
      await invalidateTemplates();
      toast(`«${t.displayName ?? t.name}» enviada a revisión de Meta`);
      nav('/plantillas');
    } catch (e) {
      setErrors(messagesOf(e));
    } finally {
      setBusy(false);
    }
  }

  /** Guarda en la BD como borrador, sin llamar a Meta. Validación suave: basta con el nombre y el idioma. */
  async function saveDraft() {
    setErrors([]);
    const parsed = templateDraftSchema.safeParse(dto);
    if (!parsed.success) return setErrors([...new Set(parsed.error.issues.map((i) => i.message))]);
    setSaving(true);
    try {
      const t = draftId ? await api.put<TemplateDto>(`/api/templates/${draftId}/draft`, parsed.data) : await api.post<TemplateDto>('/api/templates/draft', parsed.data);
      setDraftId(t.id);
      await invalidateTemplates();
      toast(`Borrador «${t.displayName ?? t.name}» guardado`);
    } catch (e) {
      setErrors(messagesOf(e));
    } finally {
      setSaving(false);
    }
  }

  const needsMedia = headerFormat === 'IMAGE' || headerFormat === 'VIDEO' || headerFormat === 'DOCUMENT';

  return (
    <div className="tpl-editor">
      <div className="panel">
        <div className="section tpl-form-head">
          <button className="btn ghost" aria-label="Volver al listado" onClick={() => nav('/plantillas')}><Icon name="back" small /></button>
          <h2 style={{ margin: 0 }}>{displayName || 'Nueva plantilla'}</h2>
          <span className="pill p-grey">Borrador</span>
        </div>
        {state?.notes?.length ? (
          <div className="section">
            <div className="tpl-notes">
              <strong>Para corregir o completar:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{state.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          </div>
        ) : null}

        <div className="section">
          <div className="grid2">
            <div>
              <label className="label" htmlFor="tpl-display">Nombre de la plantilla</label>
              <input id="tpl-display" className="tpl-input" value={displayName} maxLength={120} onChange={(e) => onDisplayName(e.target.value)} placeholder="Ej. Ragnar Z-TECH" />
              <div className="hint" style={{ marginTop: 4 }}>
                Nombre en Meta:{' '}
                <input aria-label="Nombre en Meta" value={name} onChange={(e) => { setNameTouched(true); setName(e.target.value.toLowerCase()); }} style={{ border: 0, borderBottom: '1px dashed var(--line)', outline: 'none', background: 'transparent', font: 'inherit', width: '60%' }} />
              </div>
            </div>
            <div className="grid2" style={{ gap: 12 }}>
              <div>
                <label className="label" htmlFor="tpl-cat">Categoría</label>
                <select id="tpl-cat" className="tpl-input" value={category} onChange={(e) => setCategory(e.target.value as 'MARKETING' | 'UTILITY')}>
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utilidad</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="tpl-lang">Idioma</label>
                <select id="tpl-lang" className="tpl-input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="es">Español</option>
                  <option value="ca">Català</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="section">
          <span className="label">Cabecera</span>
          <div className="tpl-seg">
            {(Object.keys(HEADER_LABEL) as HeaderFormat[]).map((f) => (
              <button key={f} type="button" className={`btn${headerFormat === f ? ' primary' : ''}`} style={{ height: 30 }} aria-pressed={headerFormat === f} onClick={() => setFormat(f)}>
                {HEADER_LABEL[f]}
              </button>
            ))}
            {media && <span className="hint">Ejemplo: {media.fileName}</span>}
          </div>
          {headerFormat === 'TEXT' && (
            <div style={{ marginTop: 10 }}>
              <input className="tpl-input" aria-label="Texto de la cabecera" value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Texto de la cabecera" />
              <div className="toolbar" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                <button type="button" className="tpl-link" onClick={() => !extractVariables(headerText).length && setHeaderText(`${headerText} {{1}}`.trim())}>+ Añadir variable</button>
                <Counter n={headerText.length} max={TEMPLATE_LIMITS.headerText} />
              </div>
              {extractVariables(headerText).length > 0 && (
                <div className="tpl-example">
                  <span className="pill p-blue">Variable 1</span>
                  <input className="tpl-input" aria-label="Ejemplo de la variable de la cabecera" value={headerExample} onChange={(e) => setHeaderExample(e.target.value)} placeholder="Ejemplo, p. ej. «Juan»" />
                </div>
              )}
            </div>
          )}
          {needsMedia && (
            <div style={{ marginTop: 10 }}>
              <label className="btn" style={{ cursor: 'pointer' }}>
                <Icon name="upload" small /> {uploading ? 'Subiendo…' : media ? 'Cambiar archivo de ejemplo' : 'Subir archivo de ejemplo'}
                <input type="file" hidden accept={ACCEPT[headerFormat]} aria-label="Archivo de ejemplo de la cabecera" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              <div className="hint" style={{ marginTop: 4 }}>Meta necesita un ejemplo para revisar la plantilla. Al enviar se podrá usar otra imagen distinta en cada campaña.</div>
            </div>
          )}
        </div>

        <div className="section">
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <label className="label" htmlFor="tpl-body" style={{ margin: 0 }}>Mensaje</label>
            <span className="tpl-fmt">
              <button type="button" aria-label="Negrita" onClick={() => format('*')}><b>N</b></button>
              <button type="button" aria-label="Cursiva" onClick={() => format('_')}><i>C</i></button>
              <button type="button" aria-label="Tachado" onClick={() => format('~')}><s>T</s></button>
              <button type="button" onClick={addVariable}>+ Añadir variable</button>
            </span>
          </div>
          <textarea id="tpl-body" ref={bodyRef} className="tpl-area" style={{ marginTop: 6 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hola {{1}}, tenemos algo para ti." />
          <Counter n={body.length} max={TEMPLATE_LIMITS.body} />
          {bodyVars.map((n, i) => (
            <div key={n} className="tpl-example">
              <span className="pill p-blue">Variable {n}</span>
              <input className="tpl-input" aria-label={`Ejemplo de la variable ${n}`} value={examples[i] ?? ''} onChange={(e) => setExamples((ex) => { const c = [...ex]; c[i] = e.target.value; return c; })} placeholder="Ejemplo obligatorio, p. ej. «Juan»" />
            </div>
          ))}
        </div>

        <div className="section grid2">
          <div>
            <label className="label" htmlFor="tpl-footer">Pie de página (opcional)</label>
            <input id="tpl-footer" className="tpl-input" value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Un saludo, Gelado." />
            <Counter n={footer.length} max={TEMPLATE_LIMITS.footer} />
          </div>
          <div>
            <span className="label">Botones</span>
            {buttons.map((b, i) => (
              <div key={i} className="tpl-btn-row">
                <select className="tpl-input" aria-label={`Tipo del botón ${i + 1}`} value={b.type} onChange={(e) => patchBtn(i, { type: e.target.value as BtnType })}>
                  {(Object.keys(BTN_LABEL) as BtnType[]).map((t) => <option key={t} value={t}>{BTN_LABEL[t]}</option>)}
                </select>
                <div>
                  <input className="tpl-input" aria-label={`Texto del botón ${i + 1}`} value={b.text} onChange={(e) => patchBtn(i, { text: e.target.value })} placeholder="Texto del botón" />
                  <Counter n={b.text.length} max={TEMPLATE_LIMITS.quickReply} />
                </div>
                <button type="button" className="btn ghost" aria-label={`Quitar botón ${i + 1}`} onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))}><Icon name="close" small /></button>
                {b.type === 'URL' && (
                  <div className="extra">
                    <input className="tpl-input" aria-label={`Dirección del botón ${i + 1}`} value={b.url} onChange={(e) => patchBtn(i, { url: e.target.value })} placeholder="https://… (la variable {{1}} solo al final)" />
                    {/\{\{\s*1\s*\}\}/.test(b.url) && <input className="tpl-input" aria-label={`Ejemplo del enlace del botón ${i + 1}`} value={b.example} onChange={(e) => patchBtn(i, { example: e.target.value })} placeholder="Ejemplo de la variable" />}
                  </div>
                )}
                {b.type === 'PHONE_NUMBER' && (
                  <div className="extra"><input className="tpl-input" aria-label={`Teléfono del botón ${i + 1}`} value={b.phone} onChange={(e) => patchBtn(i, { phone: e.target.value })} placeholder="+34 600 000 000" /></div>
                )}
              </div>
            ))}
            {(marketing || optOut) && (
              <div className="tpl-btn-lock" style={{ marginBottom: 6 }}>
                <span>Respuesta rápida · «{OPT_OUT_BUTTON_TEXT}»</span>
                <span className="hint">obligatorio</span>
              </div>
            )}
            <div className="toolbar">
              <button type="button" className="tpl-link" disabled={buttons.length >= TEMPLATE_LIMITS.maxButtons - 1} onClick={() => setButtons((bs) => [...bs, { type: 'QUICK_REPLY', text: '', url: '', example: '', phone: '' }])}>+ Añadir botón</button>
              <span className="hint">(respuesta rápida, enlace o llamada)</span>
            </div>
            <label className="tpl-check" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={marketing ? true : optOut} disabled={marketing} onChange={(e) => setOptOut(e.target.checked)} />
              Añadir botón «{OPT_OUT_BUTTON_TEXT}»
            </label>
            {marketing && <div className="hint" style={{ marginTop: 4 }}>En Marketing es obligatorio: la ley exige ofrecer la baja en cada comunicación comercial.</div>}
          </div>
        </div>

        {errors.length > 0 && (
          <div className="section">
            <div className="tpl-errors" role="alert">
              {errors.length === 1 ? errors[0] : <>Revisa estos puntos:<ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul></>}
            </div>
          </div>
        )}
        <div className="section" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={() => nav('/plantillas')}>Cancelar</button>
          <button className="btn" disabled={busy || saving || uploading} onClick={saveDraft}>{saving ? 'Guardando…' : 'Guardar borrador'}</button>
          <button className="btn primary" disabled={busy || saving || uploading} onClick={submit}>{busy ? 'Enviando…' : 'Enviar a revisión de Meta'}</button>
        </div>
      </div>

      <div className="panel" style={{ padding: 14, alignSelf: 'start' }}>
        <span className="label">Vista previa</span>
        <TemplatePreview components={previewComponents} values={previewValues} headerMediaUrl={media?.url} />
        <div className="hint" style={{ marginTop: 10 }}>Meta revisa la plantilla, normalmente en minutos. Os avisaremos aquí cuando esté aprobada o si la rechaza, con el motivo.</div>
        <div className="hint" style={{ marginTop: 6 }}>«Guardar borrador» la deja en el listado sin enviarla a Meta; podéis terminarla más tarde.</div>
      </div>
    </div>
  );
}

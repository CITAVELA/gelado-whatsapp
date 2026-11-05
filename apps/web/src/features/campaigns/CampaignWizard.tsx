import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AudienceDto, CampaignDto, CampaignLaunchResultDto, CampaignReportDto, MediaDto, TemplateDto, VariableSource } from '@gelado/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtBytes, fmtDateTime, fmtEur, fmtNumber } from '../../lib/format';
import { Icon } from '../../components/Icon';
import { ConfirmModal, LabelChip, Modal, Spinner, useToast } from '../../components/ui';
import { TemplatePreview } from '../templates/TemplatePreview';
import { useTemplates } from '../templates/queries';
import { invalidateCampaigns, useAudienceCount, useContactLabels } from './queries';
import './campaigns.css';

const FIELDS = [
  { value: 'firstName', label: 'Nombre', sample: 'Juan' },
  { value: 'lastName', label: 'Apellidos', sample: 'García' },
  { value: 'displayName', label: 'Nombre completo', sample: 'Juan García' },
  { value: 'company', label: 'Empresa', sample: 'Peluquería Marisol' },
  { value: 'customerCode', label: 'Código de cliente', sample: '10234' },
  { value: 'profileName', label: 'Nombre en WhatsApp', sample: 'Juan' },
] as const;
type FieldName = (typeof FIELDS)[number]['value'];

const RATES = [10, 20, 30, 60, 120, 300];

export function variableLabel(key: string): string {
  const [part, n] = key.split('.');
  if (part === 'body') return `Variable {{${n}}} del mensaje`;
  if (part === 'header') return `Variable {{${n}}} de la cabecera`;
  return 'Variable del enlace del botón';
}

/** Valores de ejemplo para la vista previa: el campo del contacto de muestra, el respaldo o el texto fijo. */
export function previewValues(mapping: Record<string, VariableSource>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, src] of Object.entries(mapping)) {
    if ('text' in src) out[k] = src.text;
    else out[k] = FIELDS.find((f) => f.value === src.field)?.sample ?? src.fallback;
  }
  return out;
}

/** datetime-local (hora del navegador) ↔ ISO */
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

interface Form {
  name: string;
  templateId: string;
  mapping: Record<string, VariableSource>;
  headerMedia: { id: string; name: string; url: string | null } | null;
  audience: AudienceDto;
  mode: 'now' | 'later';
  scheduleLocal: string;
  rate: number;
}

const EMPTY: Form = {
  name: '',
  templateId: '',
  mapping: {},
  headerMedia: null,
  audience: { includeLabelIds: [], excludeLabelIds: [], allContacts: false },
  mode: 'now',
  scheduleLocal: '',
  rate: 20,
};

export function CampaignWizard() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const templates = useTemplates({});
  const labels = useContactLabels();
  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState(!id);
  const [savedId, setSavedId] = useState<string | undefined>(id);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  // Cargar un borrador existente
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .get<CampaignReportDto>(`/api/campaigns/${id}`)
      .then(async (r) => {
        if (cancelled) return;
        const c = r.campaign;
        if (c.status !== 'DRAFT') return nav(`/campanas/${c.id}`, { replace: true });
        let headerMedia: Form['headerMedia'] = null;
        if (c.headerMediaFileId) {
          const u = await api.get<{ url: string }>(`/api/media/${c.headerMediaFileId}/url`).catch(() => null);
          headerMedia = { id: c.headerMediaFileId, name: 'Archivo de cabecera', url: u?.url ?? null };
        }
        setForm({
          name: c.name,
          templateId: c.templateId,
          mapping: c.variableMapping,
          headerMedia,
          audience: c.audience,
          mode: c.scheduledAt ? 'later' : 'now',
          scheduleLocal: toLocalInput(c.scheduledAt),
          rate: c.ratePerMinute,
        });
        setLoaded(true);
      })
      .catch((e) => toast((e as Error).message, true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const tpl: TemplateDto | undefined = templates.data?.find((t) => t.id === form.templateId);
  const usable = (templates.data ?? []).filter((t) => t.usableInCampaigns && t.status === 'APPROVED' && t.category === 'MARKETING');
  const unusable = (templates.data ?? []).filter((t) => t.status === 'APPROVED' && t.category === 'MARKETING' && !t.usableInCampaigns);
  const vars = tpl?.variables ?? [];
  const needsMedia = !!tpl && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(tpl.headerFormat);

  // Al cambiar de plantilla se prepara el mapeo de sus variables
  function pickTemplate(templateId: string) {
    const t = templates.data?.find((x) => x.id === templateId);
    const mapping: Record<string, VariableSource> = {};
    for (const k of t?.variables ?? []) mapping[k] = form.mapping[k] ?? (k.startsWith('body.1') ? { field: 'firstName', fallback: 'cliente' } : { text: '' });
    set({ templateId, mapping, headerMedia: null });
  }

  const scheduledIso = form.mode === 'later' && form.scheduleLocal ? new Date(form.scheduleLocal).toISOString() : null;
  const hasAudience = form.audience.allContacts || form.audience.includeLabelIds.length > 0;
  const count = useAudienceCount({ audience: form.audience, templateId: form.templateId || null, ratePerMinute: form.rate, scheduledAt: scheduledIso }, loaded && hasAudience);
  const c = hasAudience ? count.data : undefined;

  // Validación de la página (lo mínimo para guardar / lanzar)
  const problems = useMemo(() => {
    const p: string[] = [];
    if (!form.name.trim()) p.push('Ponle un nombre a la campaña.');
    if (!tpl) p.push('Elige una plantilla.');
    else {
      for (const k of vars) {
        const s = form.mapping[k];
        if (!s || ('text' in s && !s.text.trim())) p.push(`Indica qué se envía en «${variableLabel(k)}».`);
      }
      if (needsMedia && !form.headerMedia) p.push('Sube el archivo de la cabecera.');
    }
    if (!hasAudience) p.push('Elige a quién se envía (etiquetas o todos los contactos).');
    else if (c && c.willReceive === 0) p.push('Ningún contacto recibiría la campaña con estos criterios.');
    if (form.mode === 'later' && (!form.scheduleLocal || new Date(form.scheduleLocal).getTime() < Date.now() + 60_000)) p.push('Elige una fecha y hora futuras para programar el envío.');
    return p;
  }, [form, tpl, vars, needsMedia, hasAudience, c]);

  const payload = () => ({
    name: form.name.trim(),
    templateId: form.templateId,
    variableMapping: form.mapping,
    headerMediaFileId: form.headerMedia?.id ?? null,
    audience: form.audience,
    scheduledAt: form.mode === 'later' ? scheduledIso : null,
    ratePerMinute: form.rate,
  });

  async function save(): Promise<string | null> {
    if (!form.name.trim() || !form.templateId) {
      toast('Para guardar el borrador pon un nombre y elige una plantilla.', true);
      return null;
    }
    setBusy(true);
    try {
      const saved = savedId ? await api.patch<CampaignDto>(`/api/campaigns/${savedId}`, payload()) : await api.post<CampaignDto>('/api/campaigns', payload());
      setSavedId(saved.id);
      await invalidateCampaigns();
      return saved.id;
    } catch (e) {
      toast((e as Error).message, true);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    const sid = await save();
    if (sid) {
      toast('Borrador guardado');
      nav('/campanas');
    }
  }

  async function launch() {
    const sid = await save();
    if (!sid) return;
    try {
      const r = await api.post<CampaignLaunchResultDto>(`/api/campaigns/${sid}/launch`, { scheduledAt: scheduledIso });
      await invalidateCampaigns();
      toast(r.scheduled ? 'Campaña programada' : 'Campaña lanzada');
      nav(`/campanas/${sid}`);
    } catch (e) {
      toast((e as Error).message, true);
      throw e;
    }
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const m = await api.upload<MediaDto>('/api/media', fd);
      set({ headerMedia: { id: m.id, name: m.fileName ?? file.name, url: m.url } });
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  if (!loaded || templates.isLoading) {
    return <div className="empty"><Spinner /></div>;
  }

  const unit = c && c.willReceive ? c.estimatedCost / c.willReceive : 0.0585;
  const multiDay = !!c && c.plan.length > 1;

  return (
    <>
      <div className="cmp-head">
        <button className="btn ghost" style={{ padding: '0 6px' }} aria-label="Volver a campañas" onClick={() => nav('/campanas')}>‹</button>
        <h1>{id ? 'Editar campaña' : 'Nueva campaña'}</h1>
        <span className="pill p-grey">Borrador</span>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={saveDraft} disabled={busy}>Guardar borrador</button>
      </div>
      <div className="cmp-wizard">
        <div className="panel">
          <div className="section">
            <h2>1 · Detalles de la campaña</h2>
            <label className="label" htmlFor="cmp-name">Nombre de la campaña <span className="hint">(solo para uso interno)</span></label>
            <input id="cmp-name" className="cmp-input" style={{ maxWidth: 480 }} value={form.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="Ej. Afeitadora Z-TECH RAGNAR · Barberías" />
          </div>

          <div className="section">
            <h2>2 · Contenido</h2>
            <div className="grid2">
              <div>
                <label className="label" htmlFor="cmp-tpl">Plantilla de WhatsApp</label>
                <select id="cmp-tpl" className="cmp-input" value={form.templateId} onChange={(e) => pickTemplate(e.target.value)}>
                  <option value="">Elige una plantilla…</option>
                  {usable.map((t) => (
                    <option key={t.id} value={t.id}>{t.displayName ?? t.name} · Marketing</option>
                  ))}
                  {unusable.length > 0 && (
                    <optgroup label="Sin botón «No recibir más» (no se pueden usar)">
                      {unusable.map((t) => (
                        <option key={t.id} value={t.id} disabled>{t.displayName ?? t.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <div className="cmp-tpl-note">
                  Solo se pueden usar plantillas de marketing aprobadas con botón «No recibir más».{' '}
                  {unusable.length > 0 && (
                    <>Hay {unusable.length} sin ese botón: <button type="button" className="cmp-link" onClick={() => nav('/plantillas')}>Duplicar con botón de baja</button>.</>
                  )}
                </div>
              </div>
              {needsMedia && (
                <div>
                  <span className="label">{tpl!.headerFormat === 'IMAGE' ? 'Imagen' : tpl!.headerFormat === 'VIDEO' ? 'Vídeo' : 'Documento'} de cabecera</span>
                  <div className="field">
                    <span>{form.headerMedia ? form.headerMedia.name : 'Ningún archivo'}</span>
                    <button type="button" className="cmp-link" onClick={() => fileRef.current?.click()}>{form.headerMedia ? 'Cambiar' : 'Subir archivo'}</button>
                    <input ref={fileRef} type="file" hidden aria-label="Archivo de cabecera" accept={tpl!.headerFormat === 'IMAGE' ? 'image/jpeg,image/png' : tpl!.headerFormat === 'VIDEO' ? 'video/mp4' : undefined} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
                  </div>
                  <div className="hint" style={{ marginTop: 4 }}>{tpl!.headerFormat === 'IMAGE' ? 'JPG o PNG, hasta 5 MB.' : `Hasta ${fmtBytes(16 * 1024 * 1024)}.`}</div>
                </div>
              )}
            </div>
            {vars.map((k) => {
              const src = form.mapping[k] ?? { text: '' };
              const mode = 'text' in src ? 'text' : (src.field as string);
              return (
                <div className="cmp-var" key={k}>
                  <span className="name">{variableLabel(k)}</span>
                  <select className="cmp-input" aria-label={`Origen de ${variableLabel(k)}`} value={mode} onChange={(e) => set({ mapping: { ...form.mapping, [k]: e.target.value === 'text' ? { text: '' } : { field: e.target.value as FieldName, fallback: 'field' in src ? src.fallback : '' } } })}>
                    {FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>Campo «{f.label}»</option>
                    ))}
                    <option value="text">Texto fijo</option>
                  </select>
                  {'text' in src ? (
                    <input className="cmp-input" aria-label={`Texto fijo de ${variableLabel(k)}`} placeholder="Texto que se enviará a todos" value={src.text} onChange={(e) => set({ mapping: { ...form.mapping, [k]: { text: e.target.value } } })} />
                  ) : (
                    <input className="cmp-input" aria-label={`Texto de respaldo de ${variableLabel(k)}`} placeholder="Si está vacío: ej. «cliente»" value={src.fallback} onChange={(e) => set({ mapping: { ...form.mapping, [k]: { ...src, fallback: e.target.value } } })} />
                  )}
                </div>
              );
            })}
          </div>

          <div className="section">
            <h2>3 · Destinatarios</h2>
            <div className="grid2">
              <div>
                <span className="label">Enviar a contactos con la etiqueta</span>
                <LabelPicker all={labels.data ?? []} selected={form.audience.includeLabelIds} exclude={form.audience.excludeLabelIds} onChange={(ids) => set({ audience: { ...form.audience, includeLabelIds: ids, allContacts: ids.length ? false : form.audience.allContacts } })} />
                <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
                  <input type="checkbox" checked={form.audience.allContacts && !form.audience.includeLabelIds.length} disabled={form.audience.includeLabelIds.length > 0} onChange={(e) => set({ audience: { ...form.audience, allContacts: e.target.checked } })} />
                  Todos los contactos {form.audience.includeLabelIds.length > 0 && '(quita las etiquetas para usarlo)'}
                </label>
              </div>
              <div>
                <span className="label">Excluir contactos con la etiqueta</span>
                <LabelPicker all={labels.data ?? []} selected={form.audience.excludeLabelIds} exclude={form.audience.includeLabelIds} onChange={(ids) => set({ audience: { ...form.audience, excludeLabelIds: ids } })} />
              </div>
            </div>
            <div className="cmp-count" aria-live="polite">
              {!hasAudience ? (
                <span className="hint">Elige una etiqueta o «Todos los contactos» para ver cuántos recibirán el mensaje.</span>
              ) : !c ? (
                <Spinner />
              ) : (
                <>
                  <span><b className="mono">{fmtNumber(c.selected)}</b> seleccionados</span>
                  {c.excludedByLabel > 0 && <span className="hint"><b className="mono" style={{ color: 'var(--ink)' }}>{fmtNumber(c.excludedByLabel)}</b> excluidos por etiqueta</span>}
                  <span className="hint"><b className="mono" style={{ color: 'var(--ink)' }}>{fmtNumber(c.excludedRevoked)}</b> dados de baja (no reciben nunca)</span>
                  <span className="hint"><b className="mono" style={{ color: 'var(--ink)' }}>{fmtNumber(c.excludedInvalid)}</b> teléfono no válido</span>
                  {c.excludedDuplicate > 0 && <span className="hint"><b className="mono" style={{ color: 'var(--ink)' }}>{fmtNumber(c.excludedDuplicate)}</b> duplicados</span>}
                  {c.excludedNoPhone > 0 && <span className="hint" data-testid="excl-nophone"><b className="mono" style={{ color: 'var(--ink)' }}>{fmtNumber(c.excludedNoPhone)}</b> sin WhatsApp</span>}
                  {c.excludedDeleted > 0 && <span className="hint"><b className="mono" style={{ color: 'var(--ink)' }}>{fmtNumber(c.excludedDeleted)}</b> borrados</span>}
                  <span className="total">{fmtNumber(c.willReceive)} recibirán el mensaje</span>
                </>
              )}
            </div>
          </div>

          <div className="section">
            <h2>4 · Opciones de envío</h2>
            <div className="cmp-radio-row">
              <button type="button" className={`radio${form.mode === 'now' ? ' on' : ''}`} onClick={() => set({ mode: 'now' })} aria-pressed={form.mode === 'now'}>
                <span className="dotr" />
                <div><div style={{ fontWeight: 600 }}>Enviar inmediatamente</div><div className="hint">Empieza al pulsar Enviar.</div></div>
              </button>
              <div className={`radio${form.mode === 'later' ? ' on' : ''}`} onClick={() => set({ mode: 'later' })} role="button" tabIndex={0} aria-pressed={form.mode === 'later'} onKeyDown={(e) => e.key === 'Enter' && set({ mode: 'later' })}>
                <span className="dotr" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>Seleccionar la hora</div>
                  <div className="hint">Programar para más tarde.</div>
                  <input type="datetime-local" className="cmp-input" aria-label="Fecha y hora del envío" style={{ marginTop: 8, height: 32 }} value={form.scheduleLocal} onChange={(e) => set({ mode: 'later', scheduleLocal: e.target.value })} onClick={(e) => e.stopPropagation()} />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 22, alignItems: 'center', marginTop: 12, fontSize: 13, flexWrap: 'wrap' }}>
              <span>
                Ritmo de envío{' '}
                <select className="cmp-input" aria-label="Ritmo de envío" style={{ display: 'inline-block', width: 'auto', height: 30, marginLeft: 6 }} value={form.rate} onChange={(e) => set({ rate: Number(e.target.value) })}>
                  {[...new Set([...RATES, form.rate])].sort((a, b) => a - b).map((r) => (
                    <option key={r} value={r}>{r} por minuto</option>
                  ))}
                </select>
              </span>
              {c && c.willReceive > 0 && (
                <span className="hint">
                  Duración estimada: {c.estimatedMinutes >= 60 ? `${Math.floor(c.estimatedMinutes / 60)} h ${c.estimatedMinutes % 60} min` : `${c.estimatedMinutes} min`}
                  {!multiDay && ` · Dentro del límite diario de Meta (${fmtNumber(c.willReceive)} de ${fmtNumber(c.dailyLimit)})`}
                </span>
              )}
            </div>
            {multiDay && c && (
              <div className="cmp-warn" role="alert">
                <b>Se enviará en {c.plan.length} días.</b> Meta limita a {fmtNumber(c.dailyLimit)} contactos distintos cada 24 h{c.usedLast24h > 0 ? ` (ya se han usado ${fmtNumber(c.usedLast24h)})` : ''}. Reparto previsto:{' '}
                {c.plan.map((p) => `${new Date(p.day + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}: ${fmtNumber(p.count)}`).join(' · ')}.
              </div>
            )}
          </div>
        </div>

        <div className="cmp-side">
          <div className="panel" style={{ padding: 14 }}>
            <span className="label">Vista previa</span>
            {tpl ? (
              <TemplatePreview components={tpl.components} values={previewValues(form.mapping)} headerMediaUrl={form.headerMedia?.url ?? null} />
            ) : (
              <div className="hint">Elige una plantilla para ver cómo la recibirán.</div>
            )}
          </div>
          <div className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            <div style={{ fontWeight: 700 }}>Resumen</div>
            <div className="cmp-sum"><span className="hint">Destinatarios</span><b className="mono">{c ? fmtNumber(c.willReceive) : '—'}</b></div>
            <div className="cmp-sum"><span className="hint">Coste estimado ({unit.toLocaleString('es-ES', { minimumFractionDigits: 4 })} € / mensaje)</span><b className="mono">{c ? fmtEur(c.estimatedCost) : '—'}</b></div>
            <div className="cmp-sum"><span className="hint">Envío</span><b>{form.mode === 'later' && form.scheduleLocal ? fmtDateTime(scheduledIso) : 'Al lanzar'}</b></div>
          </div>
          {problems.length > 0 && (
            <ul className="hint" style={{ margin: 0, paddingLeft: 18 }} aria-label="Pendiente de completar">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {isAdmin && <button className="btn" disabled={busy || !form.templateId} onClick={() => setTestOpen(true)}>Enviar mensaje de prueba</button>}
            {isAdmin ? (
              <button className="btn primary" disabled={busy || problems.length > 0} onClick={() => setConfirm(true)}>{form.mode === 'later' ? 'Programar campaña' : 'Lanzar campaña'}</button>
            ) : (
              <span className="hint" style={{ maxWidth: 280, textAlign: 'right' }}>Puedes preparar el borrador; solo una administradora puede lanzarlo.</span>
            )}
          </div>
        </div>
      </div>

      {confirm && c && (
        <ConfirmModal
          title={form.mode === 'later' ? 'Programar campaña' : 'Lanzar campaña'}
          confirmText={form.mode === 'later' ? 'Programar' : 'Lanzar ahora'}
          text={
            <div>
              <p style={{ marginTop: 0 }}>
                {form.mode === 'later' ? <>Se enviará el <b>{fmtDateTime(scheduledIso)}</b> a</> : <>Se enviará ahora mismo a</>} <b>{fmtNumber(c.willReceive)}</b> contactos. Coste estimado: <b>{fmtEur(c.estimatedCost)}</b>.
              </p>
              {multiDay && <p>Por el límite diario de Meta se repartirá en {c.plan.length} días.</p>}
              <p className="hint" style={{ marginBottom: 0 }}>Los contactos dados de baja no recibirán nada. Podrás pausarla o cancelarla desde el informe.</p>
            </div>
          }
          onConfirm={launch}
          onClose={() => setConfirm(false)}
        />
      )}
      {testOpen && <TestModal onClose={() => setTestOpen(false)} ensureSaved={save} />}
    </>
  );
}

function LabelPicker({ all, selected, exclude, onChange }: { all: Array<{ id: string; name: string; color: string }>; selected: string[]; exclude: string[]; onChange: (ids: string[]) => void }) {
  const chosen = all.filter((l) => selected.includes(l.id));
  const options = all.filter((l) => !selected.includes(l.id) && !exclude.includes(l.id));
  return (
    <div className="cmp-chips">
      {chosen.map((l) => (
        <LabelChip key={l.id} label={l} onRemove={() => onChange(selected.filter((x) => x !== l.id))} />
      ))}
      <select aria-label="Añadir etiqueta" value="" onChange={(e) => e.target.value && onChange([...selected, e.target.value])}>
        <option value="">+ añadir</option>
        {options.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
    </div>
  );
}

function TestModal({ onClose, ensureSaved }: { onClose: () => void; ensureSaved: () => Promise<string | null> }) {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      const sid = await ensureSaved();
      if (!sid) return;
      await api.post(`/api/campaigns/${sid}/test`, { phone });
      toast('Mensaje de prueba enviado');
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Enviar mensaje de prueba" onClose={onClose} width={440} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || phone.trim().length < 6} onClick={send}>Enviar prueba</button></>}>
      <label className="label" htmlFor="cmp-test-phone">Número de teléfono</label>
      <input id="cmp-test-phone" className="cmp-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+34 617 49 82 22" autoFocus />
      <div className="hint" style={{ marginTop: 8 }}>Se guarda el borrador y se envía la plantilla con los datos de ese contacto. No cuenta en la campaña.</div>
    </Modal>
  );
}

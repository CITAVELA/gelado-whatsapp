import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { PrivacyPolicy } from '@gelado/shared';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Spinner, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { SectionHead, saveSetting, useSaveState } from './shared';

interface Preview { html: string; placeholders: string[] }

/** Ajustes → Privacidad (RF-7.6): editor Markdown con vista previa; se publica en /privacidad sin desplegar. */
export function PrivacySection() {
  const toast = useToast();
  const current = useQuery({ queryKey: ['settings', 'privacy'], queryFn: () => api.get<PrivacyPolicy>('/api/settings/privacy') });
  const [md, setMd] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const save = useSaveState();
  const seq = useRef(0);

  useEffect(() => {
    if (current.data && md === null) setMd(current.data.markdown);
  }, [current.data, md]);

  // Vista previa con retardo: el servidor sanea el HTML (lo mismo que verá el público)
  useEffect(() => {
    if (md === null) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.post<Preview>('/api/settings/privacy/preview', { markdown: md });
        if (id === seq.current) { setPreview(r); setPreviewError(false); }
      } catch {
        if (id === seq.current) setPreviewError(true);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [md]);

  if (md === null) return <div className="set-page page"><div className="empty"><Spinner /></div></div>;
  const dirty = md !== current.data?.markdown;
  const pending = preview?.placeholders ?? [];

  return (
    <div className="set-page page" style={{ maxWidth: 1240 }}>
      <SectionHead
        title="Privacidad"
        sub={<>Texto de la página pública. Se publica al guardar, sin desplegar.{current.data?.updatedAt && new Date(current.data.updatedAt).getTime() > 1e10 ? ` Última actualización: ${fmtDateTime(current.data.updatedAt)}.` : ''}</>}
        actions={<>
          <a className="btn" href="/privacidad" target="_blank" rel="noreferrer"><Icon name="eye" small />Ver página pública</a>
          <button className="btn primary" disabled={!dirty || save.busy} onClick={() => save.run(async () => {
            await saveSetting('privacy_policy', { markdown: md, updatedAt: new Date().toISOString() });
            await current.refetch();
            toast('Política publicada en /privacidad');
          })}>Guardar y publicar</button>
        </>}
      />
      {save.error && <div className="set-err" role="alert">{save.error}</div>}
      {pending.length > 0 && (
        <div className="set-warn" role="status">
          <b>Quedan campos por rellenar:</b> {pending.join(', ')}. Meta revisa esta página: complétalos antes de publicar definitivamente.
        </div>
      )}
      <div className="set-priv">
        <div className="col">
          <span className="label">Texto (Markdown)</span>
          <textarea className="area" aria-label="Texto de la política en Markdown" value={md} onChange={(e) => setMd(e.target.value)} spellCheck />
          <div className="hint"># Título · ## Sección · **negrita** · [texto](enlace) · listas con «- ». Un título puede fijar su ancla con «{'{#supresion}'}».</div>
        </div>
        <div className="col">
          <span className="label">Vista previa</span>
          {previewError && <div className="set-err">No se pudo generar la vista previa.</div>}
          <div className="set-preview" aria-label="Vista previa de la política" dangerouslySetInnerHTML={{ __html: preview?.html ?? '' }} />
        </div>
      </div>
    </div>
  );
}

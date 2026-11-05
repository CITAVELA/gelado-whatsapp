import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ImportField, ImportJobDto, ImportOptionsDto, ImportPreviewDto, ImportRowIssue, ImportUploadResultDto } from '@gelado/shared';
import { Icon } from '../../components/Icon';
import { Spinner, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtNumber } from '../../lib/format';
import { errMsg, useLabels, useRefreshContact } from './hooks';
import { MappingStep } from './MappingStep';

const STEPS = ['Subir archivo', 'Columnas', 'Reglas', 'Revisar', 'Importar'];
const COUNTRIES: Array<[string, string]> = [['ES', 'España (+34)'], ['PT', 'Portugal (+351)'], ['FR', 'Francia (+33)'], ['IT', 'Italia (+39)'], ['DE', 'Alemania (+49)'], ['GB', 'Reino Unido (+44)'], ['AD', 'Andorra (+376)'], ['MA', 'Marruecos (+212)']];

interface Rules { defaultCountry: string; onDuplicate: 'update' | 'skip'; addLabelIds: string[]; noPublicidadIsOptOut: boolean; initialConsent: 'UNKNOWN' | 'GRANTED'; createMissingLabels: boolean }

function Steps({ step }: { step: number }) {
  return (
    <div className="steps" style={{ marginLeft: 'auto' }} aria-label="Pasos de la importación">
      {STEPS.map((s, i) => (
        <span key={s} style={{ display: 'contents' }}>
          {i > 0 && <span>—</span>}
          <div className={`s${i + 1 < step ? ' done' : i + 1 === step ? ' on' : ''}`} aria-current={i + 1 === step ? 'step' : undefined}>
            <span className="n">{i + 1 < step ? '✓' : i + 1}</span>{s}
          </div>
        </span>
      ))}
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: number | undefined; bad?: boolean }) {
  return <div className="ct-stat-row"><span>{label}</span><b className={`mono${bad && value ? ' ct-warn' : ''}`}>{fmtNumber(value ?? 0)}</b></div>;
}

export function ImportWizard() {
  const toast = useToast();
  const refresh = useRefreshContact();
  const labels = useLabels('CONTACT');
  const [step, setStep] = useState(1);
  const [up, setUp] = useState<ImportUploadResultDto | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportField>>({});
  const [rules, setRules] = useState<Rules>({ defaultCountry: 'ES', onDuplicate: 'update', addLabelIds: [], noPublicidadIsOptOut: true, initialConsent: 'UNKNOWN', createMissingLabels: true });
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const options = (): ImportOptionsDto => ({
    mapping, defaultCountry: rules.defaultCountry, onDuplicate: rules.onDuplicate, addLabelIds: rules.addLabelIds,
    optOutLabelValues: rules.noPublicidadIsOptOut ? ['NO PUBLICIDAD'] : [], initialConsent: rules.initialConsent, createMissingLabels: rules.createMissingLabels,
  });

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.upload<ImportUploadResultDto>('/api/contacts/import', fd);
      setUp(r); setMapping(r.suggestedMapping); setPreview(null); setStep(2);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function goReview() {
    if (!up) return;
    setBusy(true); setError('');
    try {
      setPreview(await api.post<ImportPreviewDto>(`/api/contacts/import/${up.jobId}/preview`, options()));
      setStep(4);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!up) return;
    setBusy(true); setError('');
    try {
      await api.post<ImportJobDto>(`/api/contacts/import/${up.jobId}/run`, {});
      setJobId(up.jobId); setStep(5);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const job = useQuery({
    queryKey: ['contacts', 'import', jobId],
    queryFn: () => api.get<ImportJobDto>(`/api/contacts/import/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && (q.state.data.status === 'DONE' || q.state.data.status === 'FAILED') ? false : 1000),
  });
  const finished = job.data?.status === 'DONE';
  useEffect(() => { if (finished) { refresh(); toast('Importación terminada'); } }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasPhone = Object.values(mapping).includes('phone');

  return (
    <main className="main">
      <div className="page" style={{ maxWidth: 1180, width: '100%', margin: '0 auto' }}>
        <div className="page-head">
          <Link className="btn ghost" to="/contactos" style={{ padding: '0 6px' }} aria-label="Volver a contactos"><Icon name="back" small /></Link>
          <h1>Importar contactos</h1>
          <Steps step={step} />
        </div>

        {step === 1 && (
          <div className={`ct-files${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]); }}>
            <Icon name="upload" />
            <p style={{ margin: '8px 0', fontWeight: 600 }}>Arrastra aquí tu archivo CSV o Excel (.xlsx)</p>
            <p className="hint">Hasta 10 MB y 50.000 filas. La primera fila debe tener los nombres de las columnas.</p>
            <label className="btn primary" style={{ marginTop: 10 }}>
              {busy ? <Spinner /> : 'Elegir archivo'}
              <input type="file" accept=".csv,.txt,.xlsx" className="sr-only" aria-label="Archivo a importar" onChange={(e) => upload(e.target.files?.[0])} disabled={busy} />
            </label>
          </div>
        )}

        {step >= 2 && step <= 4 && up && (
          <div className="hint">Archivo: <b style={{ color: 'var(--ink)' }}>{up.fileName}</b> · {fmtNumber(up.totalRows)} filas · {up.columns.length} columnas</div>
        )}

        {step === 2 && up && (
          <>
            <MappingStep columns={up.columns} mapping={mapping} sampleRows={up.sampleRows} onChange={(c, f) => setMapping({ ...mapping, [c]: f })} />
            <Footer back={() => { setStep(1); setUp(null); }} next={() => setStep(3)} nextText="Siguiente: reglas" disabled={!hasPhone} />
          </>
        )}

        {step === 3 && (
          <>
            <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 }}>
              <div className="row"><label className="grow" htmlFor="r-country">País por defecto de los teléfonos</label>
                <select id="r-country" className="field" style={{ width: 200, height: 32 }} value={rules.defaultCountry} onChange={(e) => setRules({ ...rules, defaultCountry: e.target.value })}>
                  {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select></div>
              <div className="row"><label className="grow" htmlFor="r-dup">Si el contacto ya existe (mismo teléfono)</label>
                <select id="r-dup" className="field" style={{ width: 200, height: 32 }} value={rules.onDuplicate} onChange={(e) => setRules({ ...rules, onDuplicate: e.target.value as Rules['onDuplicate'] })}>
                  <option value="update">Actualizar (sin borrar datos con vacíos)</option>
                  <option value="skip">Omitir</option>
                </select></div>
              <div>
                <div className="label">Añadir estas etiquetas a todos los importados</div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {(labels.data ?? []).map((l) => (
                    <label key={l.id} className="row" style={{ gap: 4, fontSize: 13 }}>
                      <input type="checkbox" className="ct-check" checked={rules.addLabelIds.includes(l.id)} onChange={(e) => setRules({ ...rules, addLabelIds: e.target.checked ? [...rules.addLabelIds, l.id] : rules.addLabelIds.filter((x) => x !== l.id) })} />{l.name}
                    </label>
                  ))}
                </div>
              </div>
              <label className="row" style={{ gap: 10 }}><input type="checkbox" className="ct-check" checked={rules.createMissingLabels} onChange={(e) => setRules({ ...rules, createMissingLabels: e.target.checked })} />Crear las etiquetas de la columna de listas que no existan</label>
              <label className="row" style={{ gap: 10 }}><input type="checkbox" className="ct-check" checked={rules.noPublicidadIsOptOut} onChange={(e) => setRules({ ...rules, noPublicidadIsOptOut: e.target.checked })} />La etiqueta NO PUBLICIDAD significa baja (no recibirá campañas)</label>
              <div className="row"><label className="grow" htmlFor="r-consent">Consentimiento de los contactos nuevos</label>
                <select id="r-consent" className="field" style={{ width: 200, height: 32 }} value={rules.initialConsent} onChange={(e) => setRules({ ...rules, initialConsent: e.target.value as Rules['initialConsent'] })}>
                  <option value="UNKNOWN">Sin constancia</option>
                  <option value="GRANTED">Con consentimiento</option>
                </select></div>
              <div className="hint">Los contactos dados de baja nunca se reactivan con una importación.</div>
            </div>
            {error && <div className="err" role="alert">{error}</div>}
            <Footer back={() => setStep(2)} next={goReview} nextText="Siguiente: revisar" busy={busy} />
          </>
        )}

        {step === 4 && preview && (
          <>
            <div className="ct-import-grid">
              <div className="panel tbl-wrap">
                <table>
                  <thead><tr><th>Fila</th><th>Teléfono</th><th>Nombre</th><th>Etiquetas</th><th>Qué pasará</th></tr></thead>
                  <tbody>
                    {preview.sample.map((s) => (
                      <tr key={s.row}><td className="mono">{s.row}</td><td className="mono">{s.phoneE164}</td><td>{s.name || '—'}</td><td className="hint">{s.labels.join(', ')}</td>
                        <td><span className={`pill ${s.action === 'create' ? 'p-ok' : s.action === 'update' ? 'p-blue' : 'p-grey'}`}>{s.action === 'create' ? 'Se crea' : s.action === 'update' ? 'Se actualiza' : 'Se omite'}</span></td></tr>
                    ))}
                  </tbody>
                </table>
                <IssueTable title={`Problemas encontrados (${fmtNumber(preview.totalIssues ?? preview.issues.length)})`} issues={preview.issues} />
              </div>
              <div className="panel" style={{ padding: 16, alignSelf: 'start' }}>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>Vista previa del resultado</div>
                <div className="col" style={{ gap: 8 }}>
                  <Stat label="Contactos que se crearán" value={preview.willCreate} />
                  <Stat label="Contactos que se actualizarán" value={preview.willUpdate} />
                  <Stat label="Duplicados del archivo (se unen)" value={preview.duplicatesInFile} />
                  <Stat label="Teléfono no válido (se descartan)" value={preview.invalidPhone} bad />
                  <Stat label="Dados de baja (NO PUBLICIDAD)" value={preview.willOptOut} />
                  <Stat label="Filas vacías que se ignoran" value={preview.emptyRows} />
                  <Stat label="Filas que no se importan" value={preview.willSkip} />
                </div>
              </div>
            </div>
            {error && <div className="err" role="alert">{error}</div>}
            <Footer back={() => setStep(3)} next={start} nextText={`Importar ${fmtNumber(preview.willCreate + preview.willUpdate)} contactos`} busy={busy} disabled={preview.willCreate + preview.willUpdate === 0} />
          </>
        )}

        {step === 5 && (
          <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!job.data || job.data.status === 'RUNNING' || job.data.status === 'UPLOADED' || job.data.status === 'PREVIEWED' ? (
              <>
                <div style={{ fontWeight: 700 }}>Importando…</div>
                <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.data ? Math.round((job.data.processedRows / Math.max(1, job.data.totalRows)) * 100) : 0}>
                  <i style={{ width: `${job.data ? (job.data.processedRows / Math.max(1, job.data.totalRows)) * 100 : 0}%` }} />
                </div>
                <div className="hint mono">{fmtNumber(job.data?.processedRows ?? 0)} de {fmtNumber(job.data?.totalRows ?? up?.totalRows ?? 0)} filas. Puedes cerrar la página: la importación sigue en segundo plano.</div>
              </>
            ) : job.data.status === 'FAILED' ? (
              <div className="err" role="alert">La importación ha fallado{job.data.failureMessage ? `: ${job.data.failureMessage}` : ''}. Los contactos ya creados se conservan; puedes volver a subir el archivo.</div>
            ) : (
              <>
                <div style={{ fontWeight: 700, color: 'var(--ok)' }}>Importación terminada</div>
                <div className="bar ok"><i style={{ width: '100%' }} /></div>
                <div className="grid4">
                  <div className="panel stat"><div className="k">Creados</div><div className="v">{fmtNumber(job.data.created)}</div></div>
                  <div className="panel stat"><div className="k">Actualizados</div><div className="v">{fmtNumber(job.data.updated)}</div></div>
                  <div className="panel stat"><div className="k">Omitidos</div><div className="v">{fmtNumber(job.data.skipped)}</div></div>
                  <div className="panel stat"><div className="k">Dados de baja</div><div className="v">{fmtNumber(job.data.optedOut ?? 0)}</div></div>
                </div>
                <div className="row">
                  <a className="btn" href={`/api/contacts/import/${job.data.id}/report.csv`}><Icon name="download" small />Descargar informe</a>
                  <Link className="btn primary" to="/contactos">Ver contactos</Link>
                </div>
                <IssueTable title={`Informe (${fmtNumber(job.data.errorCount ?? job.data.errors.length)} incidencias${(job.data.errorCount ?? 0) > job.data.errors.length ? `, se muestran ${job.data.errors.length}` : ''})`} issues={job.data.errors} />
              </>
            )}
          </div>
        )}
        {step === 1 && error && <div className="err" role="alert">{error}</div>}
      </div>
    </main>
  );
}

const KIND_ES = { skipped: 'Descartada', merged: 'Unida', warning: 'Aviso' } as const;

function IssueTable({ title, issues }: { title: string; issues: ImportRowIssue[] }) {
  if (!issues.length) return null;
  return (
    <div style={{ borderTop: '1px solid var(--line)' }}>
      <div style={{ padding: '10px 14px', fontWeight: 600 }}>{title}</div>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table>
          <thead><tr><th>Fila</th><th>Resultado</th><th>Motivo</th><th>Valor</th></tr></thead>
          <tbody>
            {issues.map((i, k) => (
              <tr key={`${i.row}-${k}`}><td className="mono">{i.row}</td><td>{KIND_ES[i.kind ?? 'skipped']}</td><td style={{ whiteSpace: 'normal' }}>{i.reason}</td><td className="mono hint">{i.value}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Footer({ back, next, nextText, disabled, busy }: { back: () => void; next: () => void; nextText: string; disabled?: boolean; busy?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      <Link className="btn" to="/contactos">Cancelar</Link>
      <button className="btn" onClick={back}>Atrás</button>
      <button className="btn primary" onClick={next} disabled={disabled || busy}>{busy ? <Spinner /> : nextText}</button>
    </div>
  );
}

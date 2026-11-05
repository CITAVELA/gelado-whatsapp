import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { WEEKDAYS, WEEKDAY_ES, type BusinessHours, type LabelDto, type OutOfHours, type Vacation } from '@gelado/shared';
import { api } from '../../lib/api';
import { Spinner, Toggle, useToast } from '../../components/ui';
import { SectionHead, saveSetting, useAllSettings, useSaveState } from './shared';
import { newButtonId, validateHours, validateOutOfHours, validateVacation } from './hoursModel';

/** Ajustes → Horario y respuestas automáticas (RF-7.1/7.2/7.3). */
export function HoursSection() {
  const all = useAllSettings();
  const labels = useQuery({ queryKey: ['labels', 'CONVERSATION'], queryFn: () => api.get<LabelDto[]>('/api/labels?scope=CONVERSATION').catch(() => [] as LabelDto[]) });
  const toast = useToast();
  const [bh, setBh] = useState<BusinessHours | null>(null);
  const [ooh, setOoh] = useState<OutOfHours | null>(null);
  const [vac, setVac] = useState<Vacation | null>(null);
  const save = useSaveState();

  useEffect(() => {
    if (all.data && !bh) {
      setBh(structuredClone(all.data.business_hours));
      setOoh(structuredClone(all.data.out_of_hours));
      setVac(structuredClone(all.data.vacation));
    }
  }, [all.data, bh]);

  const hourErrors = useMemo(() => (bh ? validateHours(bh) : {}), [bh]);
  const oohErrors = useMemo(() => (ooh ? validateOutOfHours(ooh) : []), [ooh]);
  const vacErrors = useMemo(() => (vac ? validateVacation(vac) : []), [vac]);
  if (!bh || !ooh || !vac) return <div className="set-page page"><div className="empty"><Spinner /></div></div>;

  const invalid = Object.keys(hourErrors).length > 0 || oohErrors.length > 0 || vacErrors.length > 0;
  const setRange = (d: (typeof WEEKDAYS)[number], i: number, k: 'from' | 'to', v: string) =>
    setBh({ ...bh, days: { ...bh.days, [d]: bh.days[d].map((r, j) => (j === i ? { ...r, [k]: v } : r)) } });
  const setDay = (d: (typeof WEEKDAYS)[number], v: BusinessHours['days'][typeof d]) => setBh({ ...bh, days: { ...bh.days, [d]: v } });
  const setBtn = (i: number, patch: Partial<OutOfHours['buttons'][number]>) => setOoh({ ...ooh, buttons: ooh.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  const onSave = () =>
    save.run(async () => {
      await saveSetting('business_hours', bh);
      await saveSetting('out_of_hours', { ...ooh, buttons: ooh.buttons.map((b) => ({ ...b, labelName: b.labelName || undefined })) });
      await saveSetting('vacation', vac);
      toast('Horario y respuestas guardados');
    });

  return (
    <div className="set-page page">
      <SectionHead
        title="Horario y respuestas automáticas"
        sub={`Zona horaria: ${bh.timezone}`}
        actions={<button className="btn primary" disabled={save.busy || invalid} onClick={onSave}>Guardar</button>}
      />
      {save.error && <div className="set-err" role="alert">{save.error}</div>}
      <div className="panel">
        <div className="section">
          <h2>Horario de atención</h2>
          <div className="tbl-wrap">
            <table className="set-hours">
              <tbody>
                {WEEKDAYS.map((d) => {
                  const r = bh.days[d];
                  const open = r.length > 0;
                  return (
                    <tr key={d}>
                      <td style={{ width: 120, fontWeight: 600 }}>{WEEKDAY_ES[d]}</td>
                      <td style={{ width: 130 }}>
                        <span className="row"><Toggle on={open} label={`${WEEKDAY_ES[d]} abierto`} onChange={(v) => setDay(d, v ? [{ from: '09:00', to: '14:00' }] : [])} /><span className="hint">{open ? 'Abierto' : 'Cerrado'}</span></span>
                      </td>
                      <td>
                        <div className="set-row">
                          {r.map((t, i) => (
                            <span key={i} className="row">
                              <input type="time" className="set-time" aria-label={`${WEEKDAY_ES[d]} tramo ${i + 1} desde`} value={t.from} onChange={(e) => setRange(d, i, 'from', e.target.value)} />–
                              <input type="time" className="set-time" aria-label={`${WEEKDAY_ES[d]} tramo ${i + 1} hasta`} value={t.to} onChange={(e) => setRange(d, i, 'to', e.target.value)} />
                              {r.length === 2 && <button className="btn ghost" aria-label={`Quitar tramo ${i + 1} del ${WEEKDAY_ES[d]}`} onClick={() => setDay(d, r.filter((_, j) => j !== i))}>×</button>}
                            </span>
                          ))}
                          {open && r.length < 2 && <button className="btn ghost" onClick={() => setDay(d, [...r, { from: '17:00', to: '20:00' }])}>+ tramo</button>}
                          {!open && <span className="hint">—</span>}
                        </div>
                        {hourErrors[d] && <div className="set-err" role="alert">{hourErrors[d]}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section set-ooh">
          <div className="col" style={{ gap: 10 }}>
            <div className="set-row"><h2 style={{ margin: 0 }}>Respuesta automática fuera de horario</h2><Toggle on={ooh.enabled} label="Respuesta fuera de horario" onChange={(v) => setOoh({ ...ooh, enabled: v })} /><span className={`pill ${ooh.enabled ? 'p-ok' : 'p-grey'}`}>{ooh.enabled ? 'Activada' : 'Desactivada'}</span></div>
            <div className="hint">Se envía cuando un cliente escribe fuera del horario, como mucho una vez cada {ooh.minHoursBetween} horas por cliente. Es gratis (cuenta como respuesta).</div>
            <label className="sr-only" htmlFor="ooh-text">Texto de la respuesta</label>
            <textarea id="ooh-text" className="area" rows={5} value={ooh.text} maxLength={1100} onChange={(e) => setOoh({ ...ooh, text: e.target.value })} />
            <span className="label" style={{ margin: '4px 0 0' }}>Botones (máx. 3, hasta 20 caracteres)</span>
            {ooh.buttons.map((b, i) => (
              <div key={b.id} className="set-btnrow">
                <input className="set-input" aria-label={`Texto del botón ${i + 1}`} value={b.title} onChange={(e) => setBtn(i, { title: e.target.value })} />
                <span className="set-count" style={b.title.length > 20 ? { color: 'var(--bad)' } : undefined}>{b.title.length}/20</span>
                {(labels.data?.length ?? 0) > 0 && (
                  <select className="set-time" style={{ width: 150 }} aria-label={`Etiqueta del botón ${i + 1}`} value={b.labelName ?? ''} onChange={(e) => setBtn(i, { labelName: e.target.value || undefined })}>
                    <option value="">Sin etiqueta</option>
                    {labels.data!.map((l) => <option key={l.id} value={l.name}>Etiquetar {l.name}</option>)}
                  </select>
                )}
                <button className="btn ghost" aria-label={`Quitar botón ${i + 1}`} onClick={() => setOoh({ ...ooh, buttons: ooh.buttons.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            {ooh.buttons.length < 3 && <div><button className="btn" onClick={() => setOoh({ ...ooh, buttons: [...ooh.buttons, { id: newButtonId(ooh), title: '' }] })}>+ Añadir botón</button></div>}
            <div className="hint">Al pulsar un botón con etiqueta, la conversación queda etiquetada automáticamente.</div>
            {oohErrors.map((e) => <div key={e} className="set-err" role="alert">{e}</div>)}
          </div>
          <div className="wa-prev" aria-label="Vista previa">
            <div className="wa-bub">{ooh.text || 'Escribe el texto…'}</div>
            {ooh.buttons.filter((b) => b.title.trim()).map((b) => <div key={b.id} className="wa-btn">{b.title}</div>)}
          </div>
        </div>

        <div className="section col" style={{ gap: 10 }}>
          <div className="set-row"><h2 style={{ margin: 0 }}>Modo vacaciones</h2><Toggle on={vac.enabled} label="Modo vacaciones" onChange={(v) => setVac({ ...vac, enabled: v })} /><span className={`pill ${vac.enabled ? 'p-ok' : 'p-grey'}`}>{vac.enabled ? 'Activado' : 'Desactivado'}</span></div>
          <div className="grid2" style={{ maxWidth: 520 }}>
            <label><span className="label">Desde</span><input type="date" className="set-input" value={vac.from ?? ''} onChange={(e) => setVac({ ...vac, from: e.target.value || null })} /></label>
            <label><span className="label">Hasta (incluido)</span><input type="date" className="set-input" value={vac.to ?? ''} onChange={(e) => setVac({ ...vac, to: e.target.value || null })} /></label>
          </div>
          <label><span className="label">Mensaje (indica el día de vuelta)</span><textarea className="area" rows={3} value={vac.text} maxLength={1100} onChange={(e) => setVac({ ...vac, text: e.target.value })} /></label>
          <div className="hint">Mientras esté activo y dentro de las fechas, sustituye a la respuesta de fuera de horario (sin botones).</div>
          {vacErrors.map((e) => <div key={e} className="set-err" role="alert">{e}</div>)}
        </div>
      </div>
    </div>
  );
}

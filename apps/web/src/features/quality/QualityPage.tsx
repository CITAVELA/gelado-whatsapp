import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CampaignComparisonRow, CostsDto, QualityStatusDto, Rates } from '@gelado/shared';
import { api, qs } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtEur } from '../../lib/format';
import { Empty, Spinner } from '../../components/ui';
import { barClass, CATEGORY_ES, fmtInt as fmtNumber, fmtRate, monthKey, monthLabel, monthName, PHONE_STATUS_ES, QUALITY_ES, QUALITY_PILL, shiftMonth, TIER_ES } from './format';
import './quality.css';

const pct = (n: number) => `${Math.round(n)} %`;

function useCosts(month: string) {
  return useQuery({ queryKey: ['quality', 'costs', month], queryFn: () => api.get<CostsDto>(`/api/quality/costs${qs({ month })}`) });
}

/** P6 · Calidad y costes: estado del número, límite, gasto del mes y comparativa de campañas. */
export function QualityPage() {
  const current = monthKey();
  const [month, setMonth] = useState(current);
  const status = useQuery({ queryKey: ['quality', 'status'], queryFn: () => api.get<QualityStatusDto>('/api/quality'), refetchInterval: 120_000 });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ rates: Rates }>('/api/settings') });
  const costs = useCosts(month);
  const prev = useCosts(shiftMonth(month, -1));
  const campaigns = useQuery({
    queryKey: ['campaigns', 'analytics'],
    queryFn: () => api.get<CampaignComparisonRow[]>('/api/campaigns/analytics').catch(() => [] as CampaignComparisonRow[]),
  });

  if (status.isLoading) return <main className="main"><div className="empty"><Spinner /></div></main>;
  if (status.isError || !status.data) return <main className="main"><div className="empty">No se pudo cargar el estado del número. Inténtalo de nuevo en unos minutos.</div></main>;
  const s = status.data;
  const rates = settings.data?.rates;
  const usedPct = s.dailyLimit ? Math.min(100, (s.usedLast24h / s.dailyLimit) * 100) : 0;
  const c = costs.data;
  const freeUsed = c?.freeServiceUsed ?? 0;
  const freeLimit = c?.freeServiceLimit ?? rates?.freeServicePerMonth ?? 1000;
  const freePct = freeLimit ? Math.min(100, (freeUsed / freeLimit) * 100) : 0;
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(current, -i));
  const categories = c ? Object.entries(c.byCategory).sort((a, b) => b[1].cost - a[1].cost) : [];
  const listed = new Set(categories.map(([k]) => k));
  // Siempre se muestran las tres categorías de pago aunque no haya mensajes
  const rows = [...categories, ...(['marketing', 'utility', 'service'] as const).filter((k) => !listed.has(k)).map((k) => [k, { count: 0, cost: 0 }] as const)];
  const rateOf = (k: string) => (!rates ? null : k === 'marketing' || k === 'marketing_lite' ? rates.marketing : k === 'utility' ? rates.utility : k.startsWith('authentication') ? rates.authentication : k === 'service' ? rates.service : null);
  const history = s.history.filter((h, i, a) => i === 0 || a[i - 1]!.qualityRating !== h.qualityRating || a[i - 1]!.messagingLimit !== h.messagingLimit);

  return (
    <main className="main">
      <div className="page" style={{ maxWidth: 1180, width: '100%', margin: '0 auto' }}>
        <div className="page-head">
          <div><h1>Calidad y costes</h1><div className="sub">Estado del número en Meta y gasto estimado de WhatsApp.</div></div>
          <select className="q-month" style={{ marginLeft: 'auto' }} aria-label="Mes" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>

        <div className="grid4">
          <div className="panel stat">
            <div className="k">Calidad del número</div>
            <div className="v" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className={`q-dot ${s.qualityRating}`} />{QUALITY_ES[s.qualityRating]}</div>
            <div className="s">{s.displayPhoneNumber} · {PHONE_STATUS_ES[(s.phoneStatus ?? 'UNKNOWN').toUpperCase()] ?? s.phoneStatus ?? 'Sin datos'}</div>
          </div>
          <div className="panel stat">
            <div className="k">Límite de Meta (usuarios nuevos / 24 h)</div>
            <div className="v">{fmtNumber(s.dailyLimit)}</div>
            <div className={`bar ${barClass(usedPct)}`} style={{ marginTop: 6 }}><i style={{ width: `${usedPct}%` }} /></div>
            <div className="s" style={{ marginTop: 4 }}>Usados en las últimas 24 h: {fmtNumber(s.usedLast24h)}{s.messagingLimit ? ` · escalón ${TIER_ES[s.messagingLimit] ?? s.messagingLimit}` : ''}</div>
          </div>
          <div className="panel stat">
            <div className="k">Respuestas gratis este mes</div>
            <div className="v">{fmtNumber(freeUsed)} <span className="hint" style={{ fontSize: 14 }}>/ {fmtNumber(freeLimit)}</span></div>
            <div className={`bar ${barClass(freePct)}`} style={{ marginTop: 6 }}><i style={{ width: `${freePct}%` }} /></div>
            <div className="s" style={{ marginTop: 4 }}>{rates ? `Desde la ${fmtNumber(freeLimit + 1)} cuestan ${fmtRate(rates.service)}` : ' '}</div>
          </div>
          <div className="panel stat">
            <div className="k">Gasto estimado de {monthName(month)}</div>
            <div className="v">{c ? fmtEur(c.total) : <Spinner />}</div>
            <div className="s">{monthName(shiftMonth(month, -1)).replace(/^./, (x) => x.toUpperCase())}: {prev.data ? fmtEur(prev.data.total) : '—'}</div>
          </div>
        </div>

        <div className="q-two">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Gasto por tipo de mensaje · {monthName(month)}</div>
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>Tipo</th><th className="q-num">Mensajes</th><th className="q-num">Tarifa</th><th className="q-num">Importe</th></tr></thead>
                <tbody>
                  {rows.map(([k, v]) => {
                    const free = k === 'service';
                    const rate = rateOf(k);
                    return (
                      <tr key={k}>
                        <td>{CATEGORY_ES[k] ?? k}</td>
                        <td className="mono q-num">{fmtNumber(v.count)}</td>
                        <td className="mono q-num">{free ? <span className="hint">gratis hasta {fmtNumber(freeLimit)}</span> : rate == null ? '—' : fmtRate(rate)}</td>
                        <td className="mono q-num" style={{ fontWeight: v.cost ? 700 : 400 }}>{fmtEur(v.cost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>Estimación con las tarifas de Meta, sin IVA. La factura real la emite Meta. Puedes ajustar las tarifas en Ajustes → WhatsApp.</div>

            <div style={{ fontWeight: 700, margin: '18px 0 8px' }}>Gasto por campaña</div>
            {c && c.byCampaign.length ? (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Campaña</th><th className="q-num">Mensajes</th><th className="q-num">Importe</th></tr></thead>
                  <tbody>
                    {c.byCampaign.map((r) => (
                      <tr key={r.campaignId}>
                        <td><Link to={`/campanas/${r.campaignId}`}>{r.name}</Link></td>
                        <td className="mono q-num">{fmtNumber(r.count)}</td>
                        <td className="mono q-num">{fmtEur(r.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="hint">Ninguna campaña ha generado gasto este mes.</div>}
          </div>

          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Historial de calidad</div>
            {history.length ? (
              <div className="q-hist">
                {history.map((h) => (
                  <div key={h.createdAt}>
                    <span>{fmtDateTime(h.createdAt)}{h.messagingLimit ? ` · límite ${TIER_ES[h.messagingLimit] ?? h.messagingLimit}` : ''}</span>
                    <span className={`pill ${QUALITY_PILL[h.qualityRating]}`}>{QUALITY_ES[h.qualityRating]}</span>
                  </div>
                ))}
              </div>
            ) : <div className="hint">Todavía no hay datos. Se consulta a Meta cada hora.</div>}
            <div className="hint" style={{ marginTop: 12 }}>Si la calidad baja, aparece un aviso arriba en todas las pantallas. Si llega a baja (roja) o Meta marca el número, conviene parar las campañas en curso.</div>
            {s.lastWebhookAt && <div className="hint" style={{ marginTop: 6 }}>Último aviso recibido de Meta: {fmtDateTime(s.lastWebhookAt)}</div>}
          </div>
        </div>

        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Comparativa de campañas</div>
          {campaigns.isLoading ? <Spinner /> : campaigns.data && campaigns.data.length ? (
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>Campaña</th><th>Enviada</th><th className="q-num">Destinatarios</th><th className="q-num">Entregados</th><th className="q-num">Leídos</th><th className="q-num">Respondidos</th><th className="q-num">Bajas</th></tr></thead>
                <tbody>
                  {campaigns.data.map((r) => (
                    <tr key={r.campaignId}>
                      <td><Link to={`/campanas/${r.campaignId}`}>{r.name}</Link></td>
                      <td>{r.sentAt ? fmtDate(r.sentAt) : '—'}</td>
                      <td className="mono q-num">{fmtNumber(r.recipients)}</td>
                      <td className="mono q-num">{pct(r.deliveredPct)}</td>
                      <td className="mono q-num">{pct(r.readPct)}</td>
                      <td className="mono q-num">{pct(r.repliedPct)}</td>
                      <td className="mono q-num">{pct(r.optOutPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Sin campañas todavía</Empty>}
        </div>
      </div>
    </main>
  );
}

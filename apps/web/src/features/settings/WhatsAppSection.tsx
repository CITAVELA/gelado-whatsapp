import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Rates, WhatsAppSettingsDto } from '@gelado/shared';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Spinner, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PHONE_STATUS_ES, QUALITY_ES, QUALITY_PILL, TIER_ES } from '../quality/format';
import { fmtNameStatus } from '../../lib/format';
import { SectionHead, saveSetting, useAllSettings, useSaveState } from './shared';

/** «0,0585» o «0.0585» → 0.0585; NaN si no es un número válido. */
export function parseDecimal(s: string): number {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}
const toText = (n: number) => String(n).replace('.', ',');

const FIELDS: Array<{ key: 'marketing' | 'utility' | 'authentication' | 'service'; label: string }> = [
  { key: 'marketing', label: 'Marketing' },
  { key: 'utility', label: 'Utilidad' },
  { key: 'authentication', label: 'Autenticación' },
  { key: 'service', label: 'Servicio (tras las gratuitas)' },
];

function RatesForm({ rates }: { rates: Rates }) {
  const toast = useToast();
  const save = useSaveState();
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => setVals({ marketing: toText(rates.marketing), utility: toText(rates.utility), authentication: toText(rates.authentication), service: toText(rates.service), free: String(rates.freeServicePerMonth) }), [rates]);
  const parsed = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, parseDecimal(v)]));
  const invalid = Object.values(parsed).some((n) => Number.isNaN(n)) || !Number.isInteger(parsed.free);
  return (
    <div className="panel section col" style={{ gap: 12 }}>
      <h2 style={{ margin: 0 }}>Tarifas de Meta (EUR por mensaje entregado)</h2>
      <div className="hint">Se usan para estimar el gasto en Calidad y costes y el coste previo de cada campaña. Actualízalas cuando Meta cambie sus precios.</div>
      <div className="grid4">
        {FIELDS.map((f) => (
          <label key={f.key}><span className="label">{f.label}</span><input className="set-input" inputMode="decimal" value={vals[f.key] ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} aria-label={`Tarifa ${f.label}`} />
            {Number.isNaN(parsed[f.key]) && <div className="set-err">Número no válido</div>}</label>
        ))}
      </div>
      <label style={{ maxWidth: 240 }}><span className="label">Respuestas gratis al mes</span><input className="set-input" inputMode="numeric" value={vals.free ?? ''} onChange={(e) => setVals({ ...vals, free: e.target.value })} aria-label="Respuestas gratis al mes" /></label>
      {save.error && <div className="set-err" role="alert">{save.error}</div>}
      <div><button className="btn primary" disabled={invalid || save.busy} onClick={() => save.run(async () => {
        await saveSetting('rates', { currency: 'EUR', marketing: parsed.marketing, utility: parsed.utility, authentication: parsed.authentication, service: parsed.service, freeServicePerMonth: parsed.free });
        toast('Tarifas guardadas');
      })}>Guardar tarifas</button></div>
    </div>
  );
}

/** Ajustes → WhatsApp: datos del número y la cuenta (solo lectura), estado del webhook y tarifas. */
export function WhatsAppSection() {
  const info = useQuery({ queryKey: ['settings', 'whatsapp'], queryFn: () => api.get<WhatsAppSettingsDto>('/api/settings/whatsapp') });
  const all = useAllSettings();
  const d = info.data;
  const staleDays = d?.lastWebhookAt ? (Date.now() - new Date(d.lastWebhookAt).getTime()) / 86400000 : null;
  return (
    <div className="set-page page">
      <SectionHead title="WhatsApp y tarifas" sub="Datos del número y de la cuenta de Meta. Solo lectura: se cambian en el Administrador de WhatsApp." actions={<button className="btn" onClick={() => void info.refetch()}><Icon name="refresh" small />Actualizar</button>} />
      <div className="panel section">
        <h2>Número y cuenta</h2>
        {info.isLoading ? <Spinner /> : info.isError || !d ? <div className="empty">No se pudieron leer los datos de la cuenta.</div> : (
          <dl className="set-kv">
            <dt>Número</dt><dd><b>{d.displayPhoneNumber}</b>{d.verifiedName ? ` · ${d.verifiedName}` : ''}</dd>
            <dt>Estado del número</dt><dd>{PHONE_STATUS_ES[(d.phoneStatus ?? 'UNKNOWN').toUpperCase()] ?? d.phoneStatus ?? '—'}{d.nameStatus ? ` · nombre ${fmtNameStatus(d.nameStatus)}` : ''}</dd>
            <dt>Calidad</dt><dd><span className={`pill ${QUALITY_PILL[d.qualityRating]}`}>{QUALITY_ES[d.qualityRating]}</span></dd>
            <dt>Límite de mensajes</dt><dd>{d.messagingLimit ? `${TIER_ES[d.messagingLimit] ?? d.messagingLimit} usuarios nuevos / 24 h` : '—'}</dd>
            <dt>ID de la cuenta (WABA)</dt><dd className="mono">{d.wabaId}</dd>
            <dt>ID del número</dt><dd className="mono">{d.phoneNumberId}</dd>
            <dt>ID del portfolio</dt><dd className="mono">{d.businessId}</dd>
            <dt>Versión de la Graph API</dt><dd className="mono">{d.graphApiVersion}</dd>
          </dl>
        )}
      </div>
      <div className="panel section">
        <h2>Estado del webhook</h2>
        {d && (
          <dl className="set-kv">
            <dt>Último evento recibido</dt>
            <dd>{d.lastWebhookAt ? fmtDateTime(d.lastWebhookAt) : 'Todavía no ha llegado ninguno'} {staleDays != null && staleDays > 3 && <span className="pill p-warn">Hace más de 3 días</span>}</dd>
            <dt>Pendientes de procesar</dt><dd>{d.pendingWebhookEvents}{d.failedWebhookEvents ? <> · <span className="pill p-bad">{d.failedWebhookEvents} con error</span></> : null}</dd>
            <dt>Dirección</dt><dd className="mono">{d.webhookUrl}</dd>
          </dl>
        )}
      </div>
      {all.data ? <RatesForm rates={all.data.rates} /> : <Spinner />}
    </div>
  );
}

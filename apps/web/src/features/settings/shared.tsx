import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { BusinessHours, CampaignDefaults, OutOfHours, Rates, Vacation } from '@gelado/shared';
import { HttpError, api } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { Modal, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';

export interface AllSettings {
  business_hours: BusinessHours;
  out_of_hours: OutOfHours;
  vacation: Vacation;
  rates: Rates;
  campaign_defaults: CampaignDefaults;
}

export const SETTINGS_KEY = ['settings'] as const;
export const useAllSettings = () => useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api.get<AllSettings>('/api/settings') });

/** Guarda un ajuste y refresca la caché. Lanza con el mensaje del servidor si no es válido. */
export async function saveSetting<T>(key: string, value: unknown): Promise<T> {
  const r = await api.put<T>(`/api/settings/${key}`, value);
  await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
  return r;
}

export const errMsg = (e: unknown) => (e instanceof HttpError ? e.message : e instanceof Error ? e.message : 'Algo ha fallado. Inténtalo de nuevo.');

export function SectionHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      {actions && <div className="row" style={{ marginLeft: 'auto' }}>{actions}</div>}
    </div>
  );
}

/** Copia texto al portapapeles (con alternativa si el navegador lo impide). */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } finally {
      ta.remove();
    }
  }
}

export function CopyBox({ text, label }: { text: string; label: string }) {
  const toast = useToast();
  return (
    <div className="panel set-link-box">
      <div style={{ fontWeight: 700 }}>{label}</div>
      <div className="row">
        <div className="field set-mono grow" data-testid="link-text">{text}</div>
        <button className="btn primary" onClick={async () => toast((await copyText(text)) ? 'Enlace copiado' : 'No se pudo copiar: selecciónalo a mano', false)}><Icon name="copy" small />Copiar</button>
      </div>
    </div>
  );
}

export function useSaveState() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return { busy, error, setError, run: async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); } } };
}

export { Modal };

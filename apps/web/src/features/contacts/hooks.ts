import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ConsentChangeDto, ConsentEventDto, ContactCampaignDto, ContactDto, ContactUpsertDto, LabelDto, LabelScope } from '@gelado/shared';
import { api, HttpError } from '../../lib/api';
import { useToast } from '../../components/ui';

export const keys = {
  list: ['contacts', 'list'] as const,
  one: (id: string) => ['contacts', 'one', id] as const,
  consent: (id: string) => ['contacts', 'consent', id] as const,
  campaigns: (id: string) => ['contacts', 'campaigns', id] as const,
  labels: (scope?: LabelScope) => ['labels', scope ?? 'all'] as const,
};

export function useLabels(scope?: LabelScope) {
  return useQuery({ queryKey: keys.labels(scope), queryFn: () => api.get<LabelDto[]>(`/api/labels${scope ? `?scope=${scope}` : ''}`), staleTime: 60_000 });
}

export function useContact(id: string) {
  return useQuery({ queryKey: keys.one(id), queryFn: () => api.get<ContactDto>(`/api/contacts/${id}`) });
}
export function useConsentHistory(id: string) {
  return useQuery({ queryKey: keys.consent(id), queryFn: () => api.get<ConsentEventDto[]>(`/api/contacts/${id}/consent`) });
}
export function useContactCampaigns(id: string) {
  return useQuery({ queryKey: keys.campaigns(id), queryFn: () => api.get<ContactCampaignDto[]>(`/api/contacts/${id}/campaigns`) });
}

/** Refresca ficha, historial y listados tras un cambio. */
export function useRefreshContact() {
  const qc = useQueryClient();
  return (c?: ContactDto) => {
    if (c) qc.setQueryData(keys.one(c.id), c);
    qc.invalidateQueries({ queryKey: ['contacts'] });
    // la bandeja muestra el contacto dentro de sus conversaciones
    qc.invalidateQueries({ queryKey: ['inbox'] });
  };
}

export function errMsg(e: unknown): string {
  return e instanceof HttpError ? e.message : e instanceof Error ? e.message : 'Ha ocurrido un error';
}

export function useSaveContact(id: string) {
  const refresh = useRefreshContact();
  const toast = useToast();
  return useMutation({
    mutationFn: (dto: Partial<ContactUpsertDto>) => api.patch<ContactDto>(`/api/contacts/${id}`, dto),
    onSuccess: (c) => { refresh(c); toast('Ficha guardada'); },
    onError: (e) => toast(errMsg(e), true),
  });
}

export function useChangeConsent(id: string) {
  const refresh = useRefreshContact();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (dto: ConsentChangeDto) => api.post<ContactDto>(`/api/contacts/${id}/consent`, dto),
    onSuccess: (c) => { refresh(c); qc.invalidateQueries({ queryKey: keys.consent(id) }); toast('Consentimiento actualizado'); },
    onError: (e) => toast(errMsg(e), true),
  });
}

/** «Abrir conversación»: si ya hay, se va a ella; si no, se crea con POST /api/conversations (lo implementa la bandeja). */
export function useOpenConversation() {
  const navigate = useNavigate();
  const toast = useToast();
  return async (c: Pick<ContactDto, 'conversationId' | 'phoneE164'>) => {
    if (c.conversationId) return navigate(`/bandeja/c/${c.conversationId}`);
    if (!c.phoneE164) return toast('Sin WhatsApp: este contacto no tiene teléfono', true);
    try {
      const conv = await api.post<{ id: string }>('/api/conversations', { phone: c.phoneE164 });
      navigate(`/bandeja/c/${conv.id}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) toast('Abrir una conversación nueva todavía no está disponible. Escribe desde la bandeja con el botón de nueva conversación.', true);
      else toast(errMsg(e), true);
    }
  };
}

export const CONSENT_SOURCES_MANUAL = [
  { value: 'MANUAL', label: 'Manual (lo pidió el cliente)' },
  { value: 'IMPORT', label: 'Importación' },
  { value: 'CAMPAIGN_DECLARATION', label: 'Declaración en campaña' },
] as const;

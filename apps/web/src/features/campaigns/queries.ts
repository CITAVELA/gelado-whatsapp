import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudienceCountDto, AudienceCountRequest, CampaignDto, CampaignRecipientsPage, CampaignReportDto, LabelDto } from '@gelado/shared';
import { api, qs } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useSocketEvent } from '../../lib/socket';

export const invalidateCampaigns = () => queryClient.invalidateQueries({ queryKey: ['campaigns'] });

/** Refresca las consultas de campañas cuando llega progreso por WebSocket (con antirrebote de 1 s). */
export function useCampaignLive() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useSocketEvent(
    'campaign.progress',
    useCallback(() => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void invalidateCampaigns();
      }, 1000);
    }, []),
  );
}

export function useCampaigns() {
  useCampaignLive();
  return useQuery({ queryKey: ['campaigns', 'list'], queryFn: () => api.get<CampaignDto[]>('/api/campaigns'), refetchInterval: 30_000 });
}

export function useCampaignReport(id: string | undefined) {
  useCampaignLive();
  return useQuery({
    queryKey: ['campaigns', 'report', id],
    enabled: !!id,
    queryFn: () => api.get<CampaignReportDto>(`/api/campaigns/${id}`),
    refetchInterval: (q) => (q.state.data?.campaign.status === 'RUNNING' ? 5000 : false),
  });
}

export type RecipientTab = 'all' | 'delivered' | 'read' | 'replied' | 'failed' | 'skipped';

export function useRecipients(id: string, tab: RecipientTab, q: string, page: number) {
  return useQuery({
    queryKey: ['campaigns', 'recipients', id, tab, q, page],
    queryFn: () => api.get<CampaignRecipientsPage>(`/api/campaigns/${id}/recipients${qs({ tab, q, page, pageSize: 50 })}`),
    placeholderData: (prev) => prev,
  });
}

export function useContactLabels() {
  return useQuery({ queryKey: ['labels', 'CONTACT'], queryFn: () => api.get<LabelDto[]>('/api/labels?scope=CONTACT') });
}

/** Valor con retraso (para no pedir el recuento en cada tecla). */
export function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useAudienceCount(req: AudienceCountRequest, enabled: boolean) {
  const key = useDebounced(JSON.stringify(req));
  return useQuery({
    queryKey: ['campaigns', 'audience-count', key],
    enabled,
    queryFn: () => api.post<AudienceCountDto>('/api/campaigns/audience-count', JSON.parse(key)),
    placeholderData: (prev) => prev,
    staleTime: 5000,
  });
}

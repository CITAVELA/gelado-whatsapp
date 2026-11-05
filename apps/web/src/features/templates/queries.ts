import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { TemplateDto } from '@gelado/shared';
import { api, qs } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useSocketEvent } from '../../lib/socket';

export interface TemplateFilters {
  status?: string;
  category?: string;
  q?: string;
}

/** Listado de plantillas (RF-4.4). `status: 'APPROVED'` para el chat. Se refresca solo por tiempo real. */
export function useTemplates(filters: TemplateFilters = {}) {
  useSocketEvent('template.updated', useCallback(() => void queryClient.invalidateQueries({ queryKey: ['templates'] }), []));
  return useQuery({
    queryKey: ['templates', 'list', filters],
    queryFn: () => api.get<TemplateDto[]>(`/api/templates${qs({ ...filters })}`),
  });
}

export const invalidateTemplates = () => queryClient.invalidateQueries({ queryKey: ['templates'] });

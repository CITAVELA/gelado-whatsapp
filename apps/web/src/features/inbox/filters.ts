// Estado de filtros de la bandeja en la URL (?view=&label=&topic=&tab=&assignee=): sobrevive a recargar.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { InboxView } from '@gelado/shared';
import type { ListParams } from './api';

export type Tab = 'open' | 'snoozed' | 'done';
export const TAB_STATUS = { open: 'OPEN', snoozed: 'SNOOZED', done: 'DONE' } as const;
const VIEWS: InboxView[] = ['all', 'mine', 'unassigned', 'unread', 'starred'];

export interface InboxFilters {
  view: InboxView;
  tab: Tab;
  /** etiqueta de contacto (tipo de cliente) */
  label: string | null;
  /** etiqueta de conversación (tema) */
  topic: string | null;
  assignee: string | null;
}

export function useInboxFilters() {
  const [sp, setSp] = useSearchParams();
  const filters: InboxFilters = useMemo(() => {
    const v = sp.get('view') as InboxView | null;
    const t = sp.get('tab') as Tab | null;
    return {
      view: v && VIEWS.includes(v) ? v : 'all',
      tab: t === 'snoozed' || t === 'done' ? t : 'open',
      label: sp.get('label'),
      topic: sp.get('topic'),
      assignee: sp.get('assignee'),
    };
  }, [sp]);

  const update = useCallback(
    (patch: Partial<Record<keyof InboxFilters, string | null>>) => {
      setSp(
        (old) => {
          const n = new URLSearchParams(old);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '' || (k === 'view' && v === 'all') || (k === 'tab' && v === 'open')) n.delete(k);
            else n.set(k, v);
          }
          return n;
        },
        { replace: true },
      );
    },
    [setSp],
  );
  return [filters, update] as const;
}

export function toListParams(f: InboxFilters, q: string): ListParams {
  return {
    view: f.view,
    status: TAB_STATUS[f.tab],
    labelId: f.label ?? undefined,
    conversationLabelId: f.topic ?? undefined,
    assigneeId: f.assignee ?? undefined,
    q: q.trim() || undefined,
    limit: 40,
  };
}

export const VIEW_TITLES: Record<InboxView, string> = {
  all: 'Todas las conversaciones',
  mine: 'Asignado a mí',
  unassigned: 'No asignado',
  unread: 'Sin leer',
  starred: 'Marcado',
};

/** «PELUQUERÍA» → «Peluquería» */
export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

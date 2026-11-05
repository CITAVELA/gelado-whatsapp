// Hooks de TanStack Query de la bandeja, con actualizaciones optimistas, y tiempo real.
import { useCallback, useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import type {
  ConversationDetailDto,
  ConversationListItemDto,
  CursorPage,
  MessageDto,
  SendMessageDto,
  SnoozeDto,
  TimelineItemDto,
} from '@gelado/shared';
import { inboxApi, type ListParams } from './api';
import { useToast } from '../../components/ui';

export const K = {
  counts: ['inbox', 'counts'] as const,
  lists: ['inbox', 'list'] as const,
  list: (p: ListParams) => ['inbox', 'list', p] as const,
  conv: (id: string) => ['inbox', 'conv', id] as const,
  timeline: (id: string) => ['inbox', 'timeline', id] as const,
};

type ListData = InfiniteData<CursorPage<ConversationListItemDto>, unknown>;
type TimelineData = InfiniteData<CursorPage<TimelineItemDto>, unknown>;

export function errMsg(e: unknown, fallback = 'No se ha podido completar la acción'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

// ── Consultas ──
export function useInboxCounts() {
  return useQuery({ queryKey: K.counts, queryFn: () => inboxApi.counts(), refetchInterval: 60_000 });
}

export function useConversationList(params: ListParams) {
  return useInfiniteQuery({
    queryKey: K.list(params),
    queryFn: ({ pageParam }) => inboxApi.listConversations({ ...params, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: (prev) => prev,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({ queryKey: K.conv(id ?? ''), queryFn: () => inboxApi.getConversation(id!), enabled: !!id });
}

export function useTimeline(id: string | undefined) {
  return useInfiniteQuery({
    queryKey: K.timeline(id ?? ''),
    queryFn: ({ pageParam }) => inboxApi.timeline(id!, { cursor: pageParam, limit: 40 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!id,
    refetchOnWindowFocus: false,
  });
}

/** Páginas (la primera es la más reciente) → elementos en orden cronológico, sin duplicados. */
export function flattenTimeline(data: TimelineData | undefined): TimelineItemDto[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: TimelineItemDto[] = [];
  for (const page of [...data.pages].reverse()) {
    for (const it of page.items) {
      const key = it.type === 'message' ? `m:${it.message.id}` : `e:${it.event.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

const STATIC = { staleTime: 5 * 60_000 };
export const useUsers = () => useQuery({ queryKey: ['inbox', 'users'], queryFn: () => inboxApi.users(), ...STATIC });
export const useLabels = () => useQuery({ queryKey: ['inbox', 'labels'], queryFn: () => inboxApi.labels(), ...STATIC });
export const useRates = () => useQuery({ queryKey: ['inbox', 'rates'], queryFn: () => inboxApi.rates(), ...STATIC });
export const useApprovedTemplates = (enabled = true) => useQuery({ queryKey: ['inbox', 'templates'], queryFn: () => inboxApi.approvedTemplates(), enabled, ...STATIC });
export const useLibraryFolders = (enabled = true) => useQuery({ queryKey: ['inbox', 'lib-folders'], queryFn: () => inboxApi.libraryFolders(), enabled, staleTime: 60_000 });
export const useLibraryFiles = (folderId: string | null, q: string, enabled = true) =>
  useQuery({ queryKey: ['inbox', 'lib-files', folderId, q], queryFn: () => inboxApi.libraryFiles({ folderId, q }), enabled, staleTime: 60_000, placeholderData: (p) => p });

/** Reloj que se actualiza cada `ms` (cuenta atrás de la ventana). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ── Cachés ──
function mapLists(qc: QueryClient, fn: (items: ConversationListItemDto[], params: ListParams) => ConversationListItemDto[]) {
  for (const [key, data] of qc.getQueriesData<ListData>({ queryKey: K.lists })) {
    if (!data) continue;
    const params = (key[2] ?? {}) as ListParams;
    qc.setQueryData<ListData>(key, { ...data, pages: data.pages.map((p) => ({ ...p, items: fn(p.items, params) })) });
  }
}

/** Aplica un cambio local a la conversación en detalle y en todas las listas (y la quita de la pestaña si cambia de estado). */
export function patchConversation(qc: QueryClient, id: string, patch: Partial<ConversationListItemDto>) {
  qc.setQueryData<ConversationDetailDto>(K.conv(id), (old) => (old ? { ...old, ...patch } : old));
  mapLists(qc, (items, params) =>
    items
      .map((c) => (c.id === id ? { ...c, ...patch } : c))
      .filter((c) => c.id !== id || !params.status || c.status === params.status),
  );
}

function mapTimeline(qc: QueryClient, id: string, fn: (items: TimelineItemDto[], pageIndex: number) => TimelineItemDto[]) {
  qc.setQueryData<TimelineData>(K.timeline(id), (old) => (old ? { ...old, pages: old.pages.map((p, i) => ({ ...p, items: fn(p.items, i) })) } : old));
}
const hasMessage = (data: TimelineData | undefined, mid: string) => !!data?.pages.some((p) => p.items.some((i) => i.type === 'message' && i.message.id === mid));

/** Inserta (o sustituye) un mensaje en el historial cargado. */
export function upsertMessage(qc: QueryClient, id: string, message: MessageDto) {
  const data = qc.getQueryData<TimelineData>(K.timeline(id));
  if (!data) return;
  if (hasMessage(data, message.id)) {
    mapTimeline(qc, id, (items) => items.map((it) => (it.type === 'message' && it.message.id === message.id ? { ...it, message } : it)));
  } else {
    mapTimeline(qc, id, (items, i) => (i === 0 ? [...items, { type: 'message', at: message.createdAt, message }] : items));
  }
}
export function removeMessage(qc: QueryClient, id: string, messageId: string) {
  mapTimeline(qc, id, (items) => items.filter((it) => !(it.type === 'message' && it.message.id === messageId)));
}
export function patchMessage(qc: QueryClient, id: string, messageId: string, patch: Partial<MessageDto>) {
  mapTimeline(qc, id, (items) => items.map((it) => (it.type === 'message' && it.message.id === messageId ? { ...it, message: { ...it.message, ...patch } } : it)));
}

// ── Acciones ──
export function useConversationActions() {
  const qc = useQueryClient();
  const toast = useToast();

  /** Aplica el cambio local, llama al servidor y, si falla, vuelve a pedir los datos. */
  const run = useCallback(
    async (id: string, patch: Partial<ConversationListItemDto> | null, call: () => Promise<unknown>, ok?: string) => {
      if (patch) patchConversation(qc, id, patch);
      try {
        await call();
        if (ok) toast(ok);
      } catch (e) {
        toast(errMsg(e), true);
        qc.invalidateQueries({ queryKey: ['inbox'] });
        return;
      }
      qc.invalidateQueries({ queryKey: K.counts });
      qc.invalidateQueries({ queryKey: K.lists });
    },
    [qc, toast],
  );

  return {
    done: (id: string) => run(id, { status: 'DONE', snoozedUntil: null }, () => inboxApi.done(id), 'Conversación finalizada'),
    reopen: (id: string) => run(id, { status: 'OPEN', snoozedUntil: null }, () => inboxApi.reopen(id), 'Conversación reabierta'),
    star: (id: string, starred: boolean) => run(id, { starred }, () => inboxApi.star(id, starred)),
    markUnread: (id: string) => run(id, { unreadCount: 1 }, () => inboxApi.markUnread(id), 'Marcada como no leída'),
    markRead: (id: string) => run(id, { unreadCount: 0 }, () => inboxApi.markRead(id)),
    assign: (id: string, user: { id: string; name: string } | null) =>
      run(id, { assignee: user ? { id: user.id, name: user.name, initials: user.name.split(/\s+/).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') } : null }, () => inboxApi.assign(id, user?.id ?? null)),
    snooze: (id: string, dto: SnoozeDto) =>
      run(id, { status: 'SNOOZED', snoozedUntil: dto.until ?? new Date(Date.now() + 3600_000).toISOString() }, () => inboxApi.snooze(id, dto), 'Conversación pospuesta'),
    setLabels: (id: string, current: ConversationListItemDto['conversationLabels'], all: ConversationListItemDto['conversationLabels'], add: string[], remove: string[]) =>
      run(
        id,
        { conversationLabels: [...current.filter((l) => !remove.includes(l.id)), ...all.filter((l) => add.includes(l.id) && !current.some((c) => c.id === l.id))] },
        () => inboxApi.setLabels(id, { add, remove }),
      ),
  };
}

let tmpSeq = 0;
/** Envío de mensajes con mensaje provisional para texto y notas. */
export function useSendMessage(conversationId: string, me: { id: string; name: string } | null) {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async (dto: SendMessageDto, extra?: { quoted?: MessageDto['quoted'] }): Promise<MessageDto | null> => {
      let tmpId: string | null = null;
      if (dto.type === 'text' || dto.type === 'note') {
        tmpId = `tmp-${++tmpSeq}`;
        const at = new Date().toISOString();
        const isNote = dto.type === 'note';
        upsertMessage(qc, conversationId, {
          id: tmpId, conversationId, direction: isNote ? 'INTERNAL' : 'OUTBOUND', kind: isNote ? 'NOTE' : 'TEXT', body: dto.body, media: null, templateName: null,
          templateParams: null, payload: null, wamid: null, contextWamid: null, quoted: extra?.quoted ?? null, reactions: [], status: 'PENDING', errorCode: null,
          errorTitle: null, retryable: false, sentBy: me ? { id: me.id, name: me.name, initials: '' } : null, campaignId: null, campaignName: null, createdAt: at,
          sentAt: null, deliveredAt: null, readAt: null,
        });
      }
      try {
        const real = await inboxApi.sendMessage(conversationId, dto);
        if (tmpId) removeMessage(qc, conversationId, tmpId);
        upsertMessage(qc, conversationId, real);
        qc.invalidateQueries({ queryKey: K.lists });
        return real;
      } catch (e) {
        if (tmpId) removeMessage(qc, conversationId, tmpId);
        toast(errMsg(e, 'No se ha podido enviar el mensaje'), true);
        return null;
      }
    },
    [qc, toast, conversationId, me],
  );
}

export function useRetryMessage(conversationId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async (messageId: string) => {
      patchMessage(qc, conversationId, messageId, { status: 'PENDING', errorTitle: null, errorCode: null, retryable: false });
      try {
        const m = await inboxApi.retryMessage(conversationId, messageId);
        if (m?.id) upsertMessage(qc, conversationId, m);
      } catch (e) {
        toast(errMsg(e, 'No se ha podido reintentar'), true);
        qc.invalidateQueries({ queryKey: K.timeline(conversationId) });
      }
    },
    [qc, toast, conversationId],
  );
}

export function upsertEvent(qc: QueryClient, id: string, event: import('@gelado/shared').ConversationEventDto) {
  const data = qc.getQueryData<TimelineData>(K.timeline(id));
  if (!data || data.pages.some((p) => p.items.some((i) => i.type === 'event' && i.event.id === event.id))) return;
  mapTimeline(qc, id, (items, i) => (i === 0 ? [...items, { type: 'event', at: event.createdAt, event }] : items));
}

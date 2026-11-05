// Suscripción global a los eventos de la bandeja (montada en AppLayout: funciona en cualquier pantalla).
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { inboxApi } from './api';
import { K, applyMessageStatus, patchConversation, upsertEvent, upsertMessage } from './hooks';
import { createBatchedRefresh } from './refresh';
import { useRealtime } from './realtime';
import { getFocusedConversation, shouldNotify, showNotification } from './notify';
import { KIND_PREVIEW, displayLabel } from './utils';
import type { ConversationDetailDto, ConversationListItemDto, InboxCountsDto, MessageDto } from '@gelado/shared';

export function useInboxRealtime() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Refrescos de listas agrupados (ventana de 4 s) y sin peticiones con la pestaña oculta (se hacen al volver).
  const lists = useMemo(() => createBatchedRefresh(() => void qc.invalidateQueries({ queryKey: K.lists }), 4000), [qc]);
  useEffect(() => () => lists.dispose(), [lists]);
  const refreshLists = useCallback((windowMs?: number) => lists.request(windowMs), [lists]);
  // Conversaciones que acaban de recibir un envío de campaña: su `conversation.updated` se aplica al caché, sin refrescar.
  const campaignConvs = useRef(new Map<string, number>());
  const CAMPAIGN_REFRESH_MS = 30_000;

  const nameOf = useCallback(
    async (conversationId: string): Promise<string> => {
      const detail = qc.getQueryData<ConversationDetailDto>(K.conv(conversationId));
      if (detail) return displayLabel(detail.displayName, detail.phoneE164);
      for (const [, data] of qc.getQueriesData<{ pages: { items: ConversationListItemDto[] }[] }>({ queryKey: K.lists })) {
        const hit = data?.pages.flatMap((p) => p.items).find((c) => c.id === conversationId);
        if (hit) return displayLabel(hit.displayName, hit.phoneE164);
      }
      try {
        const c = await qc.fetchQuery({ queryKey: K.conv(conversationId), queryFn: () => inboxApi.getConversation(conversationId) });
        return displayLabel(c.displayName, c.phoneE164);
      } catch {
        return 'Nuevo mensaje';
      }
    },
    [qc],
  );

  useRealtime('message.created', (p: { conversationId: string; message: MessageDto; notify: boolean }) => {
    upsertMessage(qc, p.conversationId, p.message);
    if (p.message.campaignId && p.message.direction === 'OUTBOUND') {
      // Envío masivo de campaña: cientos de mensajes por hora. No invalida listas por cada uno.
      const now = Date.now();
      campaignConvs.current.set(p.conversationId, now);
      for (const [id, at] of campaignConvs.current) if (now - at > 10_000) campaignConvs.current.delete(id);
      refreshLists(CAMPAIGN_REFRESH_MS);
    } else {
      refreshLists();
    }
    if (shouldNotify(p.conversationId, p.notify)) {
      void nameOf(p.conversationId).then((name) =>
        showNotification(name, p.message.body || KIND_PREVIEW[p.message.kind] || 'Nuevo mensaje', () => navigate(`/bandeja/c/${p.conversationId}`)),
      );
    } else if (p.message.direction === 'INBOUND' && getFocusedConversation() === p.conversationId) {
      inboxApi.markRead(p.conversationId).catch(() => undefined);
    }
  });
  useRealtime('message.status', (p) => {
    applyMessageStatus(qc, p.conversationId, p.messageId, {
      status: p.status,
      errorCode: p.errorCode,
      errorTitle: p.errorTitle,
      ...(p.status === 'DELIVERED' ? { deliveredAt: p.at } : p.status === 'READ' ? { readAt: p.at } : {}),
      retryable: false,
    });
    if (p.status === 'FAILED') qc.invalidateQueries({ queryKey: K.timeline(p.conversationId) });
  });
  useRealtime('event.created', (p) => upsertEvent(qc, p.conversationId, p.event));
  useRealtime('conversation.updated', (p) => {
    const c = p.conversation;
    qc.setQueryData<ConversationDetailDto>(K.conv(c.id), (old) => (old ? { ...old, ...c } : old));
    if (campaignConvs.current.has(c.id)) {
      patchConversation(qc, c.id, c); // el DTO recibido basta: se parchea la caché y el orden se corrige en el refresco lento
      return;
    }
    refreshLists();
  });
  useRealtime('badge.counts', (p: InboxCountsDto) => qc.setQueryData(K.counts, p));
}

// Eventos en tiempo real: socket.io, o el bus simulado en modo VITE_INBOX_MOCK.
import { useEffect, useRef } from 'react';
import type { ServerToClientEvents } from '@gelado/shared';
import { getSocket } from '../../lib/socket';
import { MOCK_ENABLED } from './api';
import { mockBus } from './mock';

/** Igual que useSocketEvent, pero el handler puede cambiar sin volver a suscribirse. */
export function useRealtime<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (p: any) => (ref.current as any)(p);
    if (MOCK_ENABLED) return mockBus.on(event, fn);
    const s = getSocket();
    s.on(event, fn as any);
    return () => {
      s.off(event, fn as any);
    };
  }, [event]);
}

/** Avisa al servidor de la conversación que se está viendo. */
export function emitFocus(conversationId: string | null) {
  if (MOCK_ENABLED) return;
  try {
    getSocket().emit('conversation.focus', { conversationId });
  } catch {
    /* sin socket */
  }
}

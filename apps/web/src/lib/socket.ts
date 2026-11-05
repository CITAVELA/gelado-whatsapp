// Socket.io autenticado por cookie. Al reconectar, invalida las consultas para volver a pedir por REST
// (docs/04: nunca depender solo del socket).
import { io, type Socket } from 'socket.io-client';
import { useEffect } from 'react';
import { WS_PATH, type ClientToServerEvents, type ServerToClientEvents } from '@gelado/shared';
import { queryClient } from './query';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io({ path: WS_PATH, withCredentials: true, transports: ['websocket', 'polling'] });
    let first = true;
    socket.on('connect', () => {
      if (!first) queryClient.invalidateQueries();
      first = false;
    });
  }
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}

/** Suscribe un handler a un evento mientras el componente esté montado. */
export function useSocketEvent<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) {
  useEffect(() => {
    const s = getSocket();
    s.on(event, handler as any);
    return () => {
      s.off(event, handler as any);
    };
  }, [event, handler]);
}

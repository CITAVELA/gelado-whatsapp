import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { parse as parseCookie } from 'cookie';
import { SESSION_COOKIE, WS_PATH, type ServerToClientEvents, type ClientToServerEvents } from '@gelado/shared';
import { AuthService } from '../auth/auth.service';

/** Gateway socket.io autenticado con la cookie de sesión (docs/04 · Tiempo real). */
@WebSocketGateway({ path: WS_PATH, cors: false, serveClient: false })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly log = new Logger('Realtime');
  @WebSocketServer() server!: Server<ClientToServerEvents, ServerToClientEvents>;
  /** conversación que tiene abierta cada usuario (para no notificar) */
  readonly focus = new Map<string, string | null>();

  constructor(private readonly auth: AuthService) {}

  async handleConnection(client: Socket) {
    try {
      const cookies = parseCookie(client.handshake.headers.cookie ?? '');
      const user = await this.auth.validateSession(cookies[SESSION_COOKIE]);
      if (!user) {
        client.emit('error' as any, { message: 'No autenticado' });
        client.disconnect(true);
        return;
      }
      client.data.user = user;
      client.join('users');
      client.join(`user:${user.id}`);
      client.on('conversation.focus', (p: { conversationId: string | null }) => this.focus.set(client.id, p?.conversationId ?? null));
      client.on('disconnect', () => this.focus.delete(client.id));
    } catch (e) {
      this.log.warn(`Conexión rechazada: ${String(e)}`);
      client.disconnect(true);
    }
  }
}

/** Servicio para emitir eventos a todos los usuarios conectados. Sin servidor (pruebas) no hace nada. */
@Injectable()
export class RealtimeService {
  /** Últimos eventos emitidos (útil en pruebas) */
  readonly emitted: Array<{ event: string; payload: unknown }> = [];
  constructor(private readonly gateway: RealtimeGateway) {}

  emit<E extends keyof ServerToClientEvents>(event: E, payload: Parameters<ServerToClientEvents[E]>[0]) {
    if (this.emitted.length > 200) this.emitted.shift();
    this.emitted.push({ event: String(event), payload });
    const server = this.gateway.server as any;
    if (server?.to) server.to('users').emit(event, payload);
  }

  emitToUser<E extends keyof ServerToClientEvents>(userId: string, event: E, payload: Parameters<ServerToClientEvents[E]>[0]) {
    const server = this.gateway.server as any;
    if (server?.to) server.to(`user:${userId}`).emit(event, payload);
  }
}

@Global()
@Module({ providers: [RealtimeGateway, RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}

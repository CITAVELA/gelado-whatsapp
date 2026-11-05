import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { parse as parseCookie } from 'cookie';
import { SESSION_COOKIE, WS_PATH, type ServerToClientEvents, type ClientToServerEvents } from '@gelado/shared';
import { AuthService } from '../auth/auth.service';
import { DomainEvents } from '../events/domain-events.service';
import { config } from '../../common/config';

/** Orígenes aceptados en el handshake: el de APP_URL; en desarrollo, también localhost/127.0.0.1. */
export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // clientes no navegador (pruebas); el navegador siempre manda Origin
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  const app = new URL(config().APP_URL);
  if (o.origin === app.origin) return true;
  return config().NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(o.hostname);
}

const REVALIDATE_MS = 10 * 60 * 1000;

/** Gateway socket.io autenticado con la cookie de sesión (docs/04 · Tiempo real). */
@WebSocketGateway({
  path: WS_PATH,
  cors: false,
  serveClient: false,
  // Contra el secuestro de WebSocket entre sitios: solo el origen de la app
  allowRequest: (req: { headers: Record<string, string | undefined> }, cb: (err: string | null | undefined, ok: boolean) => void) => cb(null, originAllowed(req.headers.origin)),
})
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Realtime');
  @WebSocketServer() server!: Server<ClientToServerEvents, ServerToClientEvents>;
  /** conversación que tiene abierta cada usuario (para no notificar) */
  readonly focus = new Map<string, string | null>();

  private revalidateTimer: NodeJS.Timeout | null = null;

  constructor(private readonly auth: AuthService, private readonly events: DomainEvents) {}

  onModuleInit() {
    // Al revocar una sesión (cerrar sesión, contraseña nueva, usuario desactivado) se cortan sus sockets abiertos
    this.events.on('session.revoked', 'realtime-disconnect', (p) => {
      const server = this.server as any;
      if (!server?.in) return;
      if (p.sessionId) server.in(`session:${p.sessionId}`).disconnectSockets(true);
      if (p.userId) server.in(`user:${p.userId}`).disconnectSockets(true);
    });
    // Red de seguridad: cada 10 min se revalida la sesión de cada socket (caducada → fuera). Sin sockets no consulta.
    this.revalidateTimer = setInterval(() => void this.revalidate(), REVALIDATE_MS);
    this.revalidateTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
  }

  async revalidate() {
    const sockets = (await (this.server as any)?.fetchSockets?.()) ?? [];
    for (const sock of sockets) {
      const token = sock.data?.token as string | undefined;
      // Solo lectura (N9): no desliza la caducidad; una pestaña inactiva no mantiene viva la sesión para siempre
      const ok = await this.auth.peekSession(token).catch(() => null);
      if (!ok) sock.disconnect(true);
    }
  }

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
      client.data.token = cookies[SESSION_COOKIE];
      client.join('users');
      client.join(`user:${user.id}`);
      client.join(`session:${user.sessionId}`);
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
  readonly emitted: Array<{ event: string; payload: unknown; userId?: string }> = [];
  constructor(private readonly gateway: RealtimeGateway) {}

  emit<E extends keyof ServerToClientEvents>(event: E, payload: Parameters<ServerToClientEvents[E]>[0]) {
    if (this.emitted.length > 200) this.emitted.shift();
    this.emitted.push({ event: String(event), payload });
    const server = this.gateway.server as any;
    if (server?.to) server.to('users').emit(event, payload);
  }

  emitToUser<E extends keyof ServerToClientEvents>(userId: string, event: E, payload: Parameters<ServerToClientEvents[E]>[0]) {
    if (this.emitted.length > 200) this.emitted.shift();
    this.emitted.push({ event: String(event), payload, userId });
    const server = this.gateway.server as any;
    if (server?.to) server.to(`user:${userId}`).emit(event, payload);
  }
}

@Global()
@Module({ providers: [RealtimeGateway, RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}

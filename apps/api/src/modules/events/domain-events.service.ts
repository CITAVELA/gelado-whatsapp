import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { MessageStatus } from '@gelado/shared';

/**
 * Bus de eventos internos entre módulos (desacopla webhook ↔ campañas ↔ ajustes ↔ calidad).
 * Los handlers se ejecutan en orden y se esperan (deterministas en pruebas). Un handler que falla
 * se registra y no impide a los demás.
 */
export interface DomainEventMap {
  /** Mensaje entrante ya guardado (tras crear contacto/conversación y actualizar ventana). */
  'inbound.message': { conversationId: string; contactId: string; messageId: string; kind: string; text: string | null; buttonPayload: string | null; at: Date; optedOut: boolean; reopened: boolean };
  /** Estado de un mensaje saliente aplicado (solo si avanzó). */
  'message.status': { messageId: string; conversationId: string; campaignId: string | null; status: MessageStatus; errorCode: number | null; errorTitle: string | null; at: Date; pricingCategory: string | null; billable: boolean | null };
  /** Contacto dado de baja (cualquier origen). */
  'contact.opted_out': { contactId: string; source: string; campaignId?: string | null };
  /** Estado de plantilla cambiado (webhook o sincronización). */
  'template.status': { templateId: string; name: string; status: string; previousStatus: string | null; reason: string | null };
  /** Calidad / límite del número (webhook o sondeo). */
  'phone.quality': { qualityRating: string | null; messagingLimit: string | null; phoneStatus: string | null; event: string | null; source: 'WEBHOOK' | 'POLL'; raw: unknown };
  /** Aviso o restricción de la cuenta (account_update). */
  'account.update': { event: string; raw: unknown };
  /** Error grave de envío que obliga a parar (368, 131031, 132015, 132001). */
  /** Sesiones revocadas (cierre de sesión, contraseña nueva, usuario desactivado): el tiempo real corta sus sockets. */
  'session.revoked': { userId?: string; sessionId?: string; reason: 'logout' | 'password' | 'deactivated' };
  'sending.blocked': { code: number; scope: 'all' | 'campaign'; campaignId?: string | null; templateId?: string | null; message: string };
}

type Handler<K extends keyof DomainEventMap> = (p: DomainEventMap[K]) => Promise<void> | void;

@Injectable()
export class DomainEvents {
  private readonly log = new Logger('DomainEvents');
  private handlers = new Map<keyof DomainEventMap, Array<{ name: string; fn: Handler<any> }>>();

  on<K extends keyof DomainEventMap>(event: K, name: string, fn: Handler<K>) {
    const list = this.handlers.get(event) ?? [];
    list.push({ name, fn });
    this.handlers.set(event, list);
  }

  async emit<K extends keyof DomainEventMap>(event: K, payload: DomainEventMap[K]) {
    for (const h of this.handlers.get(event) ?? []) {
      try {
        await h.fn(payload);
      } catch (e) {
        this.log.error(`Handler ${h.name} de ${String(event)} falló: ${(e as Error)?.stack ?? e}`);
      }
    }
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class DomainEventsModule {}

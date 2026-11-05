import { Global, Injectable, Logger, Module } from '@nestjs/common';

export interface WebhookFieldContext {
  /** id de WebhookEvent */
  eventId: string;
  receivedAt: Date;
  /** entry[].id (WABA) */
  entryId: string;
}
export type WebhookFieldHandler = (value: any, ctx: WebhookFieldContext) => Promise<void>;

/**
 * Enrutador de cambios del webhook por `field` (docs/06 · Campos a suscribir).
 * - `messages` lo registra S1 (whatsapp/webhooks).
 * - `message_template_status_update`, `message_template_quality_update`, `template_category_update` → S3 (templates).
 * - `phone_number_quality_update`, `account_update` → S7 (quality).
 * Registrar en `onModuleInit`: `router.on('account_update', 'quality', fn)`.
 * El procesador de `wa-inbound` (S1) llama a `dispatch` por cada change. Si un handler lanza, el job se reintenta.
 */
@Injectable()
export class WebhookFieldRouter {
  private readonly log = new Logger('WebhookFieldRouter');
  private handlers = new Map<string, Array<{ name: string; fn: WebhookFieldHandler }>>();

  on(field: string, name: string, fn: WebhookFieldHandler) {
    const list = this.handlers.get(field) ?? [];
    list.push({ name, fn });
    this.handlers.set(field, list);
  }

  has(field: string) {
    return (this.handlers.get(field)?.length ?? 0) > 0;
  }

  async dispatch(field: string, value: any, ctx: WebhookFieldContext) {
    const list = this.handlers.get(field);
    if (!list?.length) {
      this.log.warn(`Campo de webhook sin handler: ${field}`);
      return;
    }
    for (const h of list) await h.fn(value, ctx);
  }
}

@Global()
@Module({ providers: [WebhookFieldRouter], exports: [WebhookFieldRouter] })
export class WebhookFieldRouterModule {}

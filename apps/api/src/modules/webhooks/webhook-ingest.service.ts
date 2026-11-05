import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { config } from '../../common/config';
import { PrismaService } from '../../common/prisma.service';
import { sha256 } from '../../common/tokens';
import { JobsService, QUEUES } from '../jobs/jobs.service';
import { WebhookFieldRouter } from './webhook-field-router';

/** Opciones de reintento de wa-inbound: 5 intentos con espera creciente (docs/04) */
const INBOUND_RETRY = { retryLimit: 5, retryDelay: 5, retryBackoff: true } as const;
/** Un evento sin procesar tras estos minutos lo recoge la tarea de cada minuto */
const STUCK_AFTER_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 12;

/**
 * Persistencia cruda del webhook (WebhookEvent), deduplicación y cola `wa-inbound`; y el procesador de la cola,
 * que reparte cada cambio al `WebhookFieldRouter`.
 */
@Injectable()
export class WebhookIngestService implements OnModuleInit {
  private readonly log = new Logger('Webhook');
  constructor(private readonly prisma: PrismaService, private readonly jobs: JobsService, private readonly router: WebhookFieldRouter) {}

  onModuleInit() {
    this.jobs.register<{ eventId: string }>(QUEUES.WA_INBOUND, (d) => this.process(d.eventId));
    // Red de seguridad: eventos que no llegaron a encolarse o agotaron sus reintentos
    this.jobs.register(QUEUES.CRON_MINUTE, () => this.requeueStuck().then(() => undefined));
  }

  /** Auditoría mínima de una petición con firma inválida (no se guarda el cuerpo ni se encola). */
  async recordRejected(ip: string | null, hadSignature: boolean) {
    await this.prisma.webhookEvent
      .create({ data: { signatureValid: false, field: null, payload: { rejected: true, ip, hadSignature } } })
      .catch((e) => this.log.warn(`No se pudo registrar el webhook rechazado: ${e}`));
  }

  /** Divide el POST en eventos (uno por mensaje, estado o cambio), los guarda y los encola. */
  async ingest(body: any): Promise<{ events: number; duplicates: number; ignored: number }> {
    const out = { events: 0, duplicates: 0, ignored: 0 };
    const ownPhoneId = config().WA_PHONE_NUMBER_ID;
    for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const field = String(change?.field ?? '');
        const value = change?.value ?? {};
        // Solo se ignoran los cambios que traen otro phone_number_id (plantillas o cuenta no lo traen)
        const phoneId = value?.metadata?.phone_number_id;
        if (!field || (phoneId && String(phoneId) !== ownPhoneId)) {
          out.ignored++;
          continue;
        }
        for (const ev of this.split(field, value, String(entry?.id ?? ''))) {
          const r = await this.store(field, ev.payload, ev.dedupeKey);
          if (r === 'duplicate') out.duplicates++;
          else out.events++;
        }
      }
    }
    return out;
  }

  /** Un evento por mensaje / estado; el resto de campos, uno por cambio (dedupe por hash). */
  private split(field: string, value: any, entryId: string): Array<{ payload: any; dedupeKey: string }> {
    if (field !== 'messages') return [{ payload: value, dedupeKey: `chg:${field}:${sha256(JSON.stringify({ entryId, value }))}` }];
    const base = { messaging_product: value.messaging_product, metadata: value.metadata, contacts: value.contacts ?? [] };
    const evs: Array<{ payload: any; dedupeKey: string }> = [];
    for (const m of value.messages ?? []) evs.push({ payload: { ...base, messages: [m] }, dedupeKey: `msg:${m.id}` });
    for (const s of value.statuses ?? []) evs.push({ payload: { ...base, statuses: [s] }, dedupeKey: `st:${s.id}:${s.status}${s.errors?.[0]?.code ? ':' + s.errors[0].code : ''}` });
    // Otros contenidos de `messages` (p. ej. errors de nivel superior): un evento por hash
    if (!evs.length) evs.push({ payload: value, dedupeKey: `chg:messages:${sha256(JSON.stringify({ entryId, value }))}` });
    return evs;
  }

  private async store(field: string, payload: any, dedupeKey: string): Promise<'new' | 'duplicate'> {
    let id: string;
    try {
      const ev = await this.prisma.webhookEvent.create({ data: { signatureValid: true, field, dedupeKey, payload: payload as Prisma.InputJsonValue } });
      id = ev.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'duplicate'; // Meta reenvió el mismo evento
      throw e;
    }
    // Si el encolado falla, el evento queda guardado y lo recoge la tarea de cada minuto: Meta recibe 200 igualmente
    await this.jobs.send(QUEUES.WA_INBOUND, { eventId: id }, INBOUND_RETRY).catch((e) => this.log.error(`No se pudo encolar el evento ${id}: ${e}`));
    return 'new';
  }

  /** Procesador de `wa-inbound`: idempotente; si falla, guarda el error y relanza para que pg-boss reintente. */
  async process(eventId: string): Promise<void> {
    const ev = await this.prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!ev || ev.processedAt || !ev.signatureValid || !ev.field) return;
    await this.prisma.webhookEvent.update({ where: { id: ev.id }, data: { attempts: { increment: 1 } } });
    try {
      await this.router.dispatch(ev.field, ev.payload, { eventId: ev.id, receivedAt: ev.receivedAt, entryId: config().WA_WABA_ID });
      await this.prisma.webhookEvent.update({ where: { id: ev.id }, data: { processedAt: new Date(), error: null } });
    } catch (e) {
      await this.prisma.webhookEvent.update({ where: { id: ev.id }, data: { error: String((e as Error)?.message ?? e).slice(0, 1000) } });
      throw e;
    }
  }

  /** Reencola los eventos válidos sin procesar de hace más de 2 minutos (con tope de intentos). */
  async requeueStuck(): Promise<number> {
    const rows = await this.prisma.webhookEvent.findMany({
      where: { signatureValid: true, processedAt: null, field: { not: null }, attempts: { lt: MAX_ATTEMPTS }, receivedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
      orderBy: { receivedAt: 'asc' },
      take: 100,
      select: { id: true },
    });
    for (const r of rows) await this.jobs.send(QUEUES.WA_INBOUND, { eventId: r.id }, INBOUND_RETRY);
    return rows.length;
  }
}

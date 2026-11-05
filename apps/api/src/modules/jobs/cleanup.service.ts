import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { JobsService, QUEUES } from './jobs.service';

const DAY = 24 * 3600 * 1000;
/** Eventos de webhook procesados: se conservan 90 días (docs/04) */
export const WEBHOOK_PROCESSED_RETENTION_DAYS = 90;
/** Peticiones rechazadas por firma: solo sirven para auditar un ataque reciente */
export const WEBHOOK_REJECTED_RETENTION_DAYS = 7;
/** Enlaces de invitación/restablecimiento usados o caducados */
export const TOKEN_RETENTION_DAYS = 30;
/** Filas por borrado: lotes pequeños para no bloquear la base ni arrastrar un DELETE enorme */
const BATCH = 2000;
const MAX_BATCHES = 500;

export interface CleanupResult {
  webhookProcessed: number;
  webhookRejected: number;
  sessions: number;
  tokens: number;
}

/** Limpieza diaria (03:00, `cron-daily-cleanup`): datos que ya no hacen falta (S10 M4 · S9 #16). */
@Injectable()
export class CleanupService implements OnModuleInit {
  private readonly log = new Logger('Cleanup');
  constructor(private readonly prisma: PrismaService, private readonly jobs: JobsService) {}

  onModuleInit() {
    this.jobs.register(QUEUES.CRON_DAILY, () => this.run().then(() => undefined), {}, 'daily-cleanup');
  }

  async run(now = new Date()): Promise<CleanupResult> {
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const result: CleanupResult = {
      webhookProcessed: await this.purge('webhookEvent', { processedAt: { not: null }, receivedAt: { lt: ago(WEBHOOK_PROCESSED_RETENTION_DAYS) } }),
      webhookRejected: await this.purge('webhookEvent', { signatureValid: false, receivedAt: { lt: ago(WEBHOOK_REJECTED_RETENTION_DAYS) } }),
      sessions: await this.purge('session', { expiresAt: { lt: now } }),
      tokens: await this.purge('passwordResetToken', { OR: [{ usedAt: { lt: ago(TOKEN_RETENTION_DAYS) } }, { expiresAt: { lt: ago(TOKEN_RETENTION_DAYS) } }] }),
    };
    this.log.log(`Limpieza diaria: ${JSON.stringify(result)}`);
    return result;
  }

  /** Borra por lotes las filas que cumplen `where`; devuelve cuántas. */
  private async purge(model: 'webhookEvent' | 'session' | 'passwordResetToken', where: any): Promise<number> {
    const delegate = this.prisma[model] as unknown as {
      findMany(a: unknown): Promise<Array<{ id: string }>>;
      deleteMany(a: unknown): Promise<{ count: number }>;
    };
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const rows = await delegate.findMany({ where, select: { id: true }, take: BATCH });
      if (!rows.length) break;
      total += (await delegate.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })).count;
      if (rows.length < BATCH) break;
    }
    return total;
  }
}

import { Global, Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { config } from '../../common/config';

/** Nombres de cola (docs/04 · Colas y tareas). pg-boss no admite puntos en todas las versiones: se usan guiones. */
export const QUEUES = {
  WA_INBOUND: 'wa-inbound',
  WA_MEDIA_DOWNLOAD: 'wa-media-download',
  WA_SEND: 'wa-send',
  CAMPAIGN_DISPATCH: 'campaign-dispatch',
  CAMPAIGN_SEND: 'campaign-send',
  IMPORT_RUN: 'contacts-import',
  CRON_MINUTE: 'cron-every-minute',
  CRON_HOURLY: 'cron-hourly',
  CRON_DAILY: 'cron-daily-cleanup',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type JobHandler<T = any> = (data: T, job: PgBoss.Job<T>) => Promise<void>;

interface WorkerDef {
  queue: QueueName;
  handler: JobHandler;
  options: PgBoss.WorkOptions;
}

/**
 * Envoltorio de pg-boss. Los módulos registran sus workers en `onModuleInit` con `register()`;
 * los workers arrancan en `onApplicationBootstrap` solo si WORKER_ENABLED=true.
 * En pruebas (`NODE_ENV=test`) se puede usar `runInline` para ejecutar el handler sin cola.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Jobs');
  private boss: PgBoss | null = null;
  private workers: WorkerDef[] = [];
  private handlers = new Map<string, JobHandler>();
  private started = false;
  /** En pruebas: true = send() ejecuta el handler en el acto (sin pg-boss) */
  inlineMode = config().NODE_ENV === 'test';
  /** Errores de jobs inline (para inspeccionarlos en pruebas) */
  inlineErrors: Array<{ queue: string; error: unknown }> = [];

  register<T>(queue: QueueName, handler: JobHandler<T>, options: PgBoss.WorkOptions = {}) {
    this.handlers.set(queue, handler as JobHandler);
    this.workers.push({ queue, handler: handler as JobHandler, options });
  }

  async onApplicationBootstrap() {
    if (this.inlineMode) return;
    await this.start();
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.boss = new PgBoss({ connectionString: config().DATABASE_URL.replace(/[?&]schema=[^&]+/, ''), schema: 'pgboss', max: 4 });
    this.boss.on('error', (e) => this.log.error(e));
    await this.boss.start();
    for (const q of Object.values(QUEUES)) {
      await this.boss.createQueue(q).catch(() => undefined);
    }
    if (!config().WORKER_ENABLED) return;
    for (const w of this.workers) {
      await this.boss.work(w.queue, { batchSize: 1, pollingIntervalSeconds: 1, ...w.options }, async (jobs) => {
        for (const job of jobs) await w.handler(job.data, job);
      });
    }
    await this.boss.schedule(QUEUES.CRON_MINUTE, '* * * * *', {}, { tz: 'Europe/Madrid' });
    await this.boss.schedule(QUEUES.CRON_HOURLY, '7 * * * *', {}, { tz: 'Europe/Madrid' });
    await this.boss.schedule(QUEUES.CRON_DAILY, '0 3 * * *', {}, { tz: 'Europe/Madrid' });
    this.log.log(`Workers activos: ${this.workers.map((w) => w.queue).join(', ')}`);
  }

  /** Encola un trabajo. En modo inline se ejecuta al momento (los errores se guardan en inlineErrors). */
  async send<T extends object>(queue: QueueName, data: T, options: PgBoss.SendOptions = {}): Promise<string | null> {
    if (this.inlineMode) {
      const h = this.handlers.get(queue);
      if (!h) return null;
      try {
        await h(data, { id: 'inline', name: queue, data } as PgBoss.Job<T>);
      } catch (error) {
        this.inlineErrors.push({ queue, error });
      }
      return 'inline';
    }
    if (!this.boss) await this.start();
    return this.boss!.send(queue, data, { retryLimit: 3, retryDelay: 5, retryBackoff: true, ...options });
  }

  /** Ejecuta el handler de una cola directamente (pruebas y tareas manuales). Propaga errores. */
  async runInline<T>(queue: QueueName, data: T) {
    const h = this.handlers.get(queue);
    if (!h) throw new Error(`Sin handler para ${queue}`);
    await h(data, { id: 'inline', name: queue, data } as PgBoss.Job<T>);
  }

  hasHandler(queue: QueueName) {
    return this.handlers.has(queue);
  }

  /** Trabajos fallidos en las últimas 24 h (para /api/status). */
  async failedLast24h(): Promise<number> {
    if (!this.boss) return 0;
    try {
      const db = (this.boss as any).getDb?.() ?? null;
      if (!db) return 0;
      const r = await db.executeSql(`SELECT count(*)::int AS n FROM pgboss.job WHERE state = 'failed' AND completed_on > now() - interval '24 hours'`);
      return r.rows?.[0]?.n ?? 0;
    } catch {
      return 0;
    }
  }

  async onModuleDestroy() {
    if (this.boss) await this.boss.stop({ graceful: true, timeout: 5000 }).catch(() => undefined);
  }
}

@Global()
@Module({ providers: [JobsService], exports: [JobsService] })
export class JobsModule {}

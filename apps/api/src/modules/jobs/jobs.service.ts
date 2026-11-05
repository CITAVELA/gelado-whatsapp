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

/** Colas que tienen worker de pg-boss (los crons *-cron no pasan por pg-boss: los lanza un temporizador en proceso). */
const CRON_QUEUES: ReadonlySet<string> = new Set([QUEUES.CRON_MINUTE, QUEUES.CRON_HOURLY, QUEUES.CRON_DAILY]);

/**
 * Sondeo de seguridad (s). Los trabajos nacen en este mismo proceso y `send()` despierta al worker en el acto;
 * el sondeo solo recoge reintentos con `startAfter`, trabajos que sobreviven a un reinicio, etc. (docs/04 · Consumo en Render).
 */
export const POLLING_SECONDS: Record<string, number> = { 'wa-inbound': 30, 'wa-send': 30 };
export const DEFAULT_POLLING_SECONDS = 60;
/** Mantenimiento interno de pg-boss (caducar/archivar/borrar), en minutos. */
export const MAINTENANCE_MINUTES = 30;

/**
 * La URL de Prisma lleva parámetros que `pg` no entiende (`schema`, `connection_limit`, `pgbouncer`…).
 * Se quitan con URL (un reemplazo con regex rompía el nombre de la base si `schema` iba primero).
 */
export function pgConnectionString(url: string): string {
  const u = new URL(url);
  for (const k of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'connect_timeout', 'socket_timeout']) u.searchParams.delete(k);
  return u.toString();
}

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
  /** varios módulos pueden registrar handlers en la misma cola (crons): se ejecutan en orden */
  private handlers = new Map<string, Array<{ name: string; fn: JobHandler }>>();
  private started = false;
  /** workerId de pg-boss por cola, para despertarlo tras `send()` */
  private workerIds = new Map<string, string>();
  private cronTimer: NodeJS.Timeout | null = null;
  private cronRunning = false;
  private stopping = false;
  /** En pruebas (sin WORKER_ENABLED): true = send() ejecuta el handler en el acto (sin pg-boss) */
  inlineMode = config().NODE_ENV === 'test' && !config().WORKER_ENABLED;
  /** Errores de jobs inline (para inspeccionarlos en pruebas) */
  inlineErrors: Array<{ queue: string; error: unknown }> = [];

  /**
   * Registra un handler. En colas de trabajo (wa-send…) debe haber uno; en crons (cron-*) puede haber varios
   * (p. ej. plantillas y calidad en cron-hourly): se ejecutan en orden y el fallo de uno no para a los demás.
   */
  register<T>(queue: QueueName, handler: JobHandler<T>, options: PgBoss.WorkOptions = {}, name: string = queue) {
    const list = this.handlers.get(queue) ?? [];
    list.push({ name, fn: handler as JobHandler });
    this.handlers.set(queue, list);
    if (!this.workers.some((w) => w.queue === queue)) {
      this.workers.push({ queue, handler: (data, job) => this.dispatch(queue, data, job), options });
    }
  }

  private async dispatch(queue: string, data: any, job: PgBoss.Job<any>) {
    const list = this.handlers.get(queue) ?? [];
    if (list.length === 1) return list[0]!.fn(data, job);
    for (const h of list) {
      try {
        await h.fn(data, job);
      } catch (e) {
        this.log.error(`Cron ${queue}/${h.name} falló: ${(e as Error)?.stack ?? e}`);
      }
    }
  }

  async onApplicationBootstrap() {
    if (this.inlineMode) return;
    await this.start();
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.boss = new PgBoss({
      connectionString: pgConnectionString(config().DATABASE_URL),
      schema: 'pgboss',
      max: 4,
      // Conexiones persistentes: con el cierre por inactividad de pg (10 s) cada sondeo abriría una conexión nueva
      // (apretón TLS + autenticación contra Supabase ≈ varios kB cada vez). Pasan tal cual a pg.Pool.
      idleTimeoutMillis: 0,
      keepAlive: true,
      // Consumo: sin planificador de pg-boss (los crons los lanza `startCronTimer`; sin monitor de reloj),
      // sin monitor de estados (no se define monitorStateIntervalSeconds) y mantenimiento cada 30 min.
      schedule: false,
      supervise: true,
      maintenanceIntervalMinutes: MAINTENANCE_MINUTES,
    } as PgBoss.ConstructorOptions);
    this.boss.on('error', (e) => this.log.error(e));
    await this.boss.start();
    for (const w of this.workers) {
      if (CRON_QUEUES.has(w.queue)) continue;
      await this.boss.createQueue(w.queue).catch(() => undefined);
    }
    // Las colas sin worker en este proceso también deben existir para poder encolar en ellas
    for (const q of Object.values(QUEUES)) {
      if (!CRON_QUEUES.has(q) && !this.workers.some((w) => w.queue === q)) await this.boss.createQueue(q).catch(() => undefined);
    }
    if (!config().WORKER_ENABLED) return;
    for (const w of this.workers) {
      if (CRON_QUEUES.has(w.queue)) continue;
      const boss = this.boss;
      const pollingIntervalSeconds = POLLING_SECONDS[w.queue] ?? DEFAULT_POLLING_SECONDS;
      const id = await boss.work(w.queue, { batchSize: 1, pollingIntervalSeconds, ...w.options }, async (jobs) => {
        try {
          for (const job of jobs) await w.handler(job.data, job);
        } catch (e) {
          // pg-boss reintenta tras `retryDelay` (5 s con backoff): despertamos al worker poco después
          this.wakeLater(w.queue, 8000);
          throw e;
        } finally {
          // con batchSize 1 puede haber más trabajos en cola: vuelve a consultar ya, sin esperar al sondeo
          this.wake(w.queue);
        }
      });
      this.workerIds.set(w.queue, id);
    }
    this.startCronTimer();
    this.log.log(`Workers activos: ${[...this.workerIds.keys()].join(', ')} · sondeo ${JSON.stringify({ ...POLLING_SECONDS, otras: DEFAULT_POLLING_SECONDS })}`);
  }

  /** Despierta al worker de la cola dentro de este proceso (sin esperar al sondeo). */
  wake(queue: string) {
    const id = this.workerIds.get(queue);
    if (id && this.boss) this.boss.notifyWorker(id);
  }

  private wakeLater(queue: string, ms: number) {
    const t = setTimeout(() => this.wake(queue), ms);
    t.unref?.();
  }

  /**
   * Planificador propio (sustituye al de pg-boss, que consulta la BD cada pocos segundos aunque no haya nada):
   * un `setTimeout` alineado al minuto llama a los handlers de los crons. Lo pendiente vive en la BD
   * (campañas, conversaciones pospuestas, eventos sin procesar), así que un reinicio no pierde nada.
   */
  private startCronTimer() {
    if (this.cronTimer) return;
    const arm = () => {
      if (this.stopping) return;
      this.cronTimer = setTimeout(() => void tick(), 60_000 - (Date.now() % 60_000) + 50);
    };
    const tick = async () => {
      if (!this.cronRunning) {
        this.cronRunning = true;
        try {
          await this.runCronsFor(new Date());
        } finally {
          this.cronRunning = false;
        }
      }
      arm();
    };
    arm();
  }

  /** Lanza los crons que tocan en `now` (hora de Madrid): cada minuto, minuto :07 y 03:00. */
  async runCronsFor(now: Date) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    const due: QueueName[] = [QUEUES.CRON_MINUTE];
    if (minute === 7) due.push(QUEUES.CRON_HOURLY);
    if (minute === 0 && hour === 3) due.push(QUEUES.CRON_DAILY);
    for (const q of due) {
      if (!this.handlers.has(q)) continue;
      try {
        await this.dispatchCron(q);
      } catch (e) {
        this.log.error(`Cron ${q} falló: ${(e as Error)?.stack ?? e}`);
      }
    }
  }

  private async dispatchCron(queue: QueueName) {
    // dispatch ya aísla el fallo de cada handler cuando hay varios; con uno propaga
    await this.dispatch(queue, {}, { id: 'cron', name: queue, data: {} } as PgBoss.Job<any>);
  }

  /** Encola un trabajo. En modo inline se ejecuta al momento (los errores se guardan en inlineErrors). */
  async send<T extends object>(queue: QueueName, data: T, options: PgBoss.SendOptions = {}): Promise<string | null> {
    if (this.inlineMode) {
      if (!this.handlers.has(queue)) return null;
      try {
        await this.dispatch(queue, data, { id: 'inline', name: queue, data } as PgBoss.Job<T>);
      } catch (error) {
        this.inlineErrors.push({ queue, error });
      }
      return 'inline';
    }
    if (!this.boss) await this.start();
    const id = await this.boss!.send(queue, data, { retryLimit: 3, retryDelay: 5, retryBackoff: true, ...options });
    this.wake(queue); // el trabajo nace en este proceso: no esperar al sondeo
    return id;
  }

  /** Ejecuta el handler de una cola directamente (pruebas y tareas manuales). Propaga errores. */
  async runInline<T>(queue: QueueName, data: T) {
    if (!this.handlers.has(queue)) throw new Error(`Sin handler para ${queue}`);
    await this.dispatch(queue, data, { id: 'inline', name: queue, data } as PgBoss.Job<T>);
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
    this.stopping = true;
    if (this.cronTimer) clearTimeout(this.cronTimer);
    this.cronTimer = null;
    if (this.boss) await this.boss.stop({ graceful: true, timeout: 5000 }).catch(() => undefined);
  }
}

@Global()
@Module({ providers: [JobsService], exports: [JobsService] })
export class JobsModule {}

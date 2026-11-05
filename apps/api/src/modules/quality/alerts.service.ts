import { Injectable, Logger } from '@nestjs/common';
import type { AlertDto } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.gateway';

type AlertKind = AlertDto['kind'];

/**
 * Alertas del banner (RF-6.2). Una fila por `dedupeKey` mientras esté activa: repetir el aviso no la duplica
 * y, cuando vuelve lo normal, se resuelve sola (`resolvedAt`). Cada cambio se avisa por WebSocket (`alert`).
 */
@Injectable()
export class AlertsService {
  private readonly log = new Logger('Alerts');
  constructor(private readonly prisma: PrismaService, private readonly realtime: RealtimeService) {}

  /** Crea o actualiza la alerta activa de `dedupeKey`. Si estaba resuelta, la reabre. */
  async raise(input: { dedupeKey: string; kind: AlertKind; level: 'warning' | 'critical'; message: string; data?: unknown }) {
    const level = input.level === 'critical' ? 'CRITICAL' : 'WARNING';
    const existing = await this.prisma.alert.findUnique({ where: { dedupeKey: input.dedupeKey } });
    let changed = false;
    if (!existing) {
      await this.prisma.alert.create({ data: { dedupeKey: input.dedupeKey, kind: input.kind, level, message: input.message, data: (input.data as any) ?? undefined } });
      changed = true;
    } else if (existing.resolvedAt) {
      await this.prisma.alert.update({
        where: { id: existing.id },
        data: { kind: input.kind, level, message: input.message, data: (input.data as any) ?? undefined, resolvedAt: null, createdAt: new Date() },
      });
      changed = true;
    } else if (existing.level !== level || existing.message !== input.message) {
      await this.prisma.alert.update({ where: { id: existing.id }, data: { level, message: input.message, data: (input.data as any) ?? undefined } });
      changed = true;
    }
    if (changed) await this.broadcast();
  }

  /** Resuelve la alerta de `dedupeKey` (o todas las que empiecen por `prefix:`) si estaba activa. */
  async resolve(dedupeKey: string) {
    const r = await this.prisma.alert.updateMany({ where: { dedupeKey, resolvedAt: null }, data: { resolvedAt: new Date() } });
    if (r.count) await this.broadcast();
    return r.count > 0;
  }

  async active(): Promise<AlertDto[]> {
    const rows = await this.prisma.alert.findMany({ where: { resolvedAt: null }, orderBy: [{ level: 'desc' }, { createdAt: 'desc' }] });
    return rows.map((a) => ({
      id: a.id,
      level: a.level === 'CRITICAL' ? 'critical' : 'warning',
      kind: a.kind as AlertKind,
      message: a.message,
      link: '/calidad',
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async activeByKey(dedupeKey: string) {
    return this.prisma.alert.findFirst({ where: { dedupeKey, resolvedAt: null } });
  }

  async broadcast() {
    try {
      this.realtime.emit('alert', { alerts: await this.active() });
    } catch (e) {
      this.log.warn(`No se pudo emitir alert: ${(e as Error).message}`);
    }
  }
}

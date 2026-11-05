import { BadRequestException, Controller, Get, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminOnly, CurrentUser, type AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { clientIp } from '../auth/auth.controller';
import { timingSafeEqual, createHash } from 'node:crypto';
import { zonedParts, type StatusDto } from '@gelado/shared';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { AlertsService } from './alerts.service';
import { QualityService } from './quality.service';

@Controller('api')
export class QualityController {
  constructor(
    private readonly quality: QualityService,
    private readonly alerts: AlertsService,
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  @Get('quality')
  status() {
    return this.quality.status();
  }

  @Get('quality/costs')
  costs(@Query('month') month?: string) {
    const m = month ?? zonedParts(new Date()).ymd.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new BadRequestException({ statusCode: 400, message: 'Mes no válido (usa AAAA-MM)' });
    return this.quality.costs(m);
  }

  @Get('alerts')
  activeAlerts() {
    return this.alerts.active();
  }

  /** La administradora da por resuelta una alerta (salida manual si Meta no manda el evento de recuperación). */
  @Post('alerts/:id/resolve')
  @HttpCode(200)
  @AdminOnly()
  async resolveAlert(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser, @Req() req: Request) {
    if (!(await this.alerts.resolveById(id))) throw new NotFoundException({ statusCode: 404, message: 'La alerta no existe o ya estaba resuelta' });
    await this.audit.log({ userId: me.id, action: 'resolve_alert', entityType: 'Alert', entityId: id, ip: clientIp(req) });
    return { ok: true };
  }

  /** Revisión diaria automática: sin sesión, con `Authorization: Bearer <STATUS_TOKEN>`. */
  @Public()
  @Get('status')
  async systemStatus(@Headers('authorization') auth?: string): Promise<StatusDto> {
    const expected = this.quality.statusToken();
    const given = /^Bearer (.+)$/.exec(auth ?? '')?.[1] ?? '';
    // Comparación en tiempo constante (hash para igualar longitudes)
    const h = (s: string) => createHash('sha256').update(s).digest();
    const ok = !!expected && !!given && timingSafeEqual(h(expected), h(given));
    if (!ok) throw new UnauthorizedException({ statusCode: 401, message: 'No autorizado' });

    const [alerts, snap, lastWebhookAt, pending, running, failedJobs] = await Promise.all([
      this.alerts.active(),
      this.quality.statusSnapshot(),
      this.quality.lastWebhookAt(),
      this.prisma.webhookEvent.count({ where: { signatureValid: true, processedAt: null } }),
      this.prisma.campaign.count({ where: { status: 'RUNNING' } }),
      this.jobs.failedLast24h(),
    ]);
    return {
      status: alerts.some((a) => a.level === 'critical') ? 'critical' : alerts.length ? 'warning' : 'ok',
      checkedAt: new Date().toISOString(),
      ...snap,
      alerts,
      lastWebhookAt: lastWebhookAt?.toISOString() ?? null,
      pendingWebhookEvents: pending,
      failedJobs24h: failedJobs,
      runningCampaigns: running,
    };
  }
}

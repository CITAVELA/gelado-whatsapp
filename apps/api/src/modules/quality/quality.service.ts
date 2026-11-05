import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { COSTABLE_MESSAGE_STATUSES, computeCost, dailyLimitForTier, WINDOW_MS, zonedTimeToUtc, type CostsDto, type QualityRating, type QualityStatusDto, type WaPhoneNumberInfo } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { config } from '../../common/config';
import { SettingsService } from '../settings/settings.service';
import { WhatsAppGateway } from '../whatsapp/whatsapp.gateway';
import { DomainEvents } from '../events/domain-events.service';
import { AlertsService } from './alerts.service';
import { phoneStopReason } from './blocking';

export { normalizeRating as normRating } from '../settings/rating';
import { normalizeRating as normRating } from '../settings/rating';

const BLOCKING_CODES = [368, 131031, 133010];
/** Eventos de account_update que no son una incidencia (informativos). */
const ACCOUNT_INFO = /^(PARTNER_|VERIFIED_ACCOUNT|AUTH_INTL|BUSINESS_PRIMARY|ACCOUNT_UPDATE_INFO)/;
const ACCOUNT_RECOVERED = /(LIFTED|REVIEW_COMPLETED|REINSTATE|RESTORED|APPROVED)/;
const ACCOUNT_CRITICAL = /(RESTRICTION|DISABLED|BAN|DELETED)/;

/**
 * Filtro de mensajes que cuentan para el gasto. ÚNICO criterio: lo usan el gasto del mes (aquí) y el informe de
 * campaña, para que ambas cifras cuadren (solo entregados/leídos, facturables y con categoría de precio).
 */
export const costableMessageWhere = (): Prisma.MessageWhereInput => ({
  direction: 'OUTBOUND',
  billable: true,
  pricingCategory: { not: null },
  status: { in: [...COSTABLE_MESSAGE_STATUSES] },
});

export type AccountEventSeverity = 'recovered' | 'info' | 'critical' | 'warning';

/** Clasifica un evento de `account_update`: lo comparten las alertas y las paradas de campañas. */
export function accountEventSeverity(event: string, raw: any): AccountEventSeverity {
  const ev = String(event ?? '').toUpperCase();
  if (ACCOUNT_RECOVERED.test(ev)) return 'recovered';
  // DISABLED_UPDATE trae el estado real en ban_info: REINSTATE = la cuenta vuelve a estar activa
  const banState = String(raw?.ban_info?.waba_ban_state ?? '').toUpperCase();
  if (banState && ACCOUNT_RECOVERED.test(banState)) return 'recovered';
  // Las infracciones de política son un aviso: no bloquean (no hay evento de recuperación); las restricciones sí
  if (/VIOLATION/.test(ev)) return 'warning';
  if (ACCOUNT_INFO.test(ev)) return 'info';
  const restrictionInfo = raw?.restriction_info;
  if (/RESTRICTION/.test(ev) && Array.isArray(restrictionInfo) && restrictionInfo.length === 0) return 'recovered';
  return ACCOUNT_CRITICAL.test(ev) ? 'critical' : 'warning';
}

/** Calidad, límite diario, alertas y costes (docs/06 · Calidad y límites, Costes). */
@Injectable()
export class QualityService {
  private readonly log = new Logger('Quality');
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly gateway: WhatsAppGateway,
    private readonly events: DomainEvents,
    private readonly alerts: AlertsService,
  ) {}

  // ───────────────────────── Sondeo y webhooks ─────────────────────────

  /** Sondeo horario: lee el número en la Graph API, guarda el snapshot y ajusta el límite diario. */
  async poll() {
    let info: WaPhoneNumberInfo;
    try {
      info = await this.gateway.getPhoneNumber();
    } catch (e) {
      this.log.warn(`Sondeo de calidad fallido: ${(e as Error).message}`);
      await this.checkWebhookStale();
      throw e;
    }
    await this.applySnapshot({
      qualityRating: normRating(info.quality_rating),
      messagingLimit: info.messaging_limit_tier ?? null,
      phoneStatus: info.status ?? null,
      source: 'POLL',
      event: null,
      raw: info,
    });
    await this.resolveSendingStopped();
    await this.checkWebhookStale();
    return info;
  }

  /** Webhook phone_number_quality_update. */
  async handlePhoneQualityUpdate(value: any) {
    const event = String(value?.event ?? '').toUpperCase() || null;
    const last = await this.latestSnapshot();
    const rating: QualityRating = last ? normRating(last.qualityRating) : 'UNKNOWN';
    let phoneStatus = last?.phoneStatus ?? null;
    if (event === 'FLAGGED') phoneStatus = 'FLAGGED';
    else if (event === 'UNFLAGGED') phoneStatus = 'CONNECTED';
    // Meta no manda la calidad en este webhook: un DOWNGRADE de calidad se confirma con el siguiente sondeo.
    const limit = (value?.current_limit as string | undefined) ?? last?.messagingLimit ?? null;
    await this.applySnapshot({ qualityRating: rating, messagingLimit: limit, phoneStatus, source: 'WEBHOOK', event, raw: value });
    // Confirmar con la API si hay cambio de calidad (sin romper el webhook si falla)
    if (event === 'DOWNGRADE' || event === 'UPGRADE') {
      await this.poll().catch(() => undefined);
    }
  }

  /** Webhook account_update. */
  async handleAccountUpdate(value: any) {
    const event = String(value?.event ?? '').toUpperCase();
    await this.events.emit('account.update', { event, raw: value });
  }

  /** Guarda el snapshot, ajusta el límite diario, abre/cierra alertas y emite `phone.quality`. */
  async applySnapshot(s: { qualityRating: QualityRating; messagingLimit: string | null; phoneStatus: string | null; source: 'POLL' | 'WEBHOOK'; event: string | null; raw: unknown }) {
    const last = await this.latestSnapshot();
    const changed = !last || last.qualityRating !== s.qualityRating || last.messagingLimit !== s.messagingLimit || last.phoneStatus !== s.phoneStatus || s.source === 'WEBHOOK';
    if (changed) {
      await this.prisma.qualitySnapshot.create({
        data: { qualityRating: s.qualityRating, messagingLimit: s.messagingLimit, phoneStatus: s.phoneStatus, source: s.source, raw: (s.raw as any) ?? undefined },
      });
    }
    // Límite diario según el escalón
    const limit = dailyLimitForTier(s.messagingLimit);
    if (limit) {
      const cd = await this.settings.get('campaign_defaults');
      if (cd.dailyLimit !== limit) await this.settings.set('campaign_defaults', { ...cd, dailyLimit: limit });
    }
    await this.syncQualityAlerts(s.qualityRating, s.phoneStatus, s.event);
    if (changed) await this.events.emit('phone.quality', { qualityRating: s.qualityRating, messagingLimit: s.messagingLimit, phoneStatus: s.phoneStatus, event: s.event, source: s.source, raw: s.raw });
  }

  private async syncQualityAlerts(rating: QualityRating, phoneStatus: string | null, event: string | null) {
    if (rating === 'RED') await this.alerts.raise({ dedupeKey: 'quality', kind: 'quality', level: 'critical', message: 'La calidad del número ha bajado a ROJA. Pausa las promociones y revisa los mensajes enviados.' });
    else if (rating === 'YELLOW') await this.alerts.raise({ dedupeKey: 'quality', kind: 'quality', level: 'warning', message: 'La calidad del número ha bajado a AMARILLA. Reduce el ritmo de las promociones.' });
    else await this.alerts.resolve('quality');

    const flagged = (phoneStatus ?? '').toUpperCase() === 'FLAGGED' || event === 'FLAGGED';
    if (flagged && event !== 'UNFLAGGED') await this.alerts.raise({ dedupeKey: 'phone_flagged', kind: 'phone_flagged', level: 'warning', message: 'Meta ha marcado el número (FLAGGED). Si la calidad no mejora en unos días, bajará el límite.' });
    else await this.alerts.resolve('phone_flagged');
  }

  // ───────────────────────── Alertas por eventos internos ─────────────────────────

  async onAccountUpdate(p: { event: string; raw: any }) {
    const ev = p.event;
    const severity = accountEventSeverity(ev, p.raw);
    if (severity === 'recovered') {
      await this.alerts.resolve('account');
      return;
    }
    if (severity === 'info') return;
    const restrictionInfo = p.raw?.restriction_info;
    const critical = severity === 'critical';
    const detail = Array.isArray(restrictionInfo) && restrictionInfo[0]?.restriction_type ? ` (${restrictionInfo[0].restriction_type})` : '';
    await this.alerts.raise({
      dedupeKey: 'account',
      kind: 'account',
      level: critical ? 'critical' : 'warning',
      message: critical ? `Meta ha restringido la cuenta de WhatsApp${detail}. Revisa el aviso en el Administrador de WhatsApp.` : `Aviso de la cuenta de WhatsApp: ${ev}.`,
      data: p.raw,
    });
  }

  async onSendingBlocked(p: { code: number; scope: 'all' | 'campaign'; message: string }) {
    if (p.scope !== 'all' || !BLOCKING_CODES.includes(p.code)) return;
    await this.alerts.raise({ dedupeKey: 'sending_stopped', kind: 'sending_stopped', level: 'critical', message: `Envíos detenidos: ${p.message} (código ${p.code}).`, data: { code: p.code } });
  }

  /** Plantilla en uso pausada o desactivada → aviso; vuelve a aprobarse → se resuelve. */
  async onTemplateStatus(p: { templateId: string; name: string; status: string }) {
    const key = `template_paused:${p.templateId}`;
    const status = p.status.toUpperCase();
    if (!['PAUSED', 'DISABLED', 'FLAGGED'].includes(status)) {
      await this.alerts.resolve(key);
      return;
    }
    const since = new Date(Date.now() - 30 * 24 * 3600_000);
    const used = await this.prisma.campaign.count({
      where: { templateId: p.templateId, OR: [{ status: { in: ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED'] } }, { createdAt: { gte: since } }] },
    });
    if (!used) return;
    const what = status === 'PAUSED' ? 'pausado' : status === 'DISABLED' ? 'desactivado' : 'marcado';
    await this.alerts.raise({
      dedupeKey: key,
      kind: 'template_paused',
      level: 'warning',
      message: `Meta ha ${what} la plantilla «${p.name}», que usan tus campañas. Revísala en Plantillas.`,
      data: { templateId: p.templateId, status },
    });
  }

  /** «Envíos detenidos» se cierra cuando vuelve a salir un mensaje después del aviso. */
  private async resolveSendingStopped() {
    const a = await this.alerts.activeByKey('sending_stopped');
    if (!a) return;
    const ok = await this.prisma.message.count({ where: { direction: 'OUTBOUND', status: { in: ['SENT', 'DELIVERED', 'READ'] }, sentAt: { gt: a.createdAt } } });
    if (ok) await this.alerts.resolve('sending_stopped');
  }

  /** Aviso opcional: no llegan webhooks desde hace días aunque se está enviando. */
  async checkWebhookStale() {
    const last = await this.prisma.webhookEvent.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } });
    const recentOut = await this.prisma.message.count({ where: { direction: 'OUTBOUND', status: { in: ['SENT', 'DELIVERED', 'READ'] }, sentAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
    const stale = recentOut > 0 && (!last || Date.now() - last.receivedAt.getTime() > 72 * 3600_000);
    if (stale) await this.alerts.raise({ dedupeKey: 'webhook_stale', kind: 'webhook_stale', level: 'warning', message: 'No llegan avisos de WhatsApp (webhook) desde hace más de 3 días. Comprueba la configuración en Meta.' });
    else await this.alerts.resolve('webhook_stale');
  }

  // ───────────────────────── Lecturas ─────────────────────────

  latestSnapshot() {
    return this.prisma.qualitySnapshot.findFirst({ orderBy: { createdAt: 'desc' } });
  }

  /**
   * Motivo (en español) por el que NO se puede enviar campañas ahora, o null. Bloquea: último snapshot en ROJO o con el
   * número FLAGGED/RESTRICTED, o una alerta crítica activa de la cuenta o de «Envíos detenidos». Son dos consultas
   * pequeñas; solo se llama cuando hay campañas que arrancar, reanudar o enviar.
   */
  async blockingReason(): Promise<string | null> {
    const snap = await this.latestSnapshot();
    const why = phoneStopReason(snap?.qualityRating, snap?.phoneStatus);
    if (why) return why;
    const alert = await this.prisma.alert.findFirst({ where: { resolvedAt: null, level: 'CRITICAL', dedupeKey: { in: ['account', 'sending_stopped'] } }, orderBy: { createdAt: 'desc' } });
    if (!alert) return null;
    if (alert.dedupeKey === 'sending_stopped') {
      // Si ya ha salido un mensaje bien después del aviso, el bloqueo ha pasado: se cierra aquí sin esperar al sondeo horario
      await this.resolveSendingStopped();
      if (!(await this.alerts.activeByKey('sending_stopped'))) return null;
      return 'los envíos están detenidos por un error grave de Meta (envía un mensaje de prueba cuando lo hayas resuelto)';
    }
    return 'Meta ha restringido la cuenta de WhatsApp';
  }

  /** Destinatarios únicos con mensaje fuera de ventana en las últimas 24 h móviles. */
  async usedLast24h(now = new Date()) {
    const since = new Date(now.getTime() - WINDOW_MS);
    const rows = await this.prisma.message.findMany({
      where: { direction: 'OUTBOUND', sentOutsideWindow: true, status: { not: 'FAILED' }, createdAt: { gte: since } },
      distinct: ['conversationId'],
      select: { conversationId: true },
    });
    return rows.length;
  }

  async lastWebhookAt() {
    const w = await this.prisma.webhookEvent.findFirst({ where: { signatureValid: true }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } });
    return w?.receivedAt ?? null;
  }

  async status(): Promise<QualityStatusDto> {
    let snap = await this.latestSnapshot();
    if (!snap) {
      await this.poll().catch(() => undefined);
      snap = await this.latestSnapshot();
    }
    const cd = await this.settings.get('campaign_defaults');
    const history = await this.prisma.qualitySnapshot.findMany({ orderBy: { createdAt: 'desc' }, take: 60 });
    const raw = (snap?.raw ?? {}) as Record<string, any>;
    return {
      qualityRating: snap ? normRating(snap.qualityRating) : 'UNKNOWN',
      phoneStatus: snap?.phoneStatus ?? null,
      messagingLimit: snap?.messagingLimit ?? null,
      dailyLimit: cd.dailyLimit,
      usedLast24h: await this.usedLast24h(),
      displayPhoneNumber: raw.display_phone_number ?? '+34 617 49 82 22',
      verifiedName: raw.verified_name ?? null,
      lastWebhookAt: (await this.lastWebhookAt())?.toISOString() ?? null,
      history: history.map((h) => ({ qualityRating: normRating(h.qualityRating), messagingLimit: h.messagingLimit, createdAt: h.createdAt.toISOString() })),
    };
  }

  /** Gasto estimado del mes (zona Madrid) con los datos de facturación que manda Meta (RF-6.4). */
  async costs(month: string): Promise<CostsDto> {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const start = zonedTimeToUtc(`${month}-01`, '00:00');
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    const end = zonedTimeToUtc(`${next}-01`, '00:00');
    const rates = await this.settings.get('rates');
    const rows = await this.prisma.message.findMany({
      where: {
        ...costableMessageWhere(),
        OR: [{ deliveredAt: { gte: start, lt: end } }, { deliveredAt: null, readAt: { gte: start, lt: end } }, { deliveredAt: null, readAt: null, sentAt: { gte: start, lt: end } }],
      },
      select: { pricingCategory: true, billable: true, campaignId: true, deliveredAt: true, readAt: true, sentAt: true },
    });
    rows.sort((a, b) => (a.deliveredAt ?? a.readAt ?? a.sentAt!).getTime() - (b.deliveredAt ?? b.readAt ?? b.sentAt!).getTime());

    const byCategory: CostsDto['byCategory'] = {};
    const perCampaign = new Map<string, { count: number; cost: number }>();
    let serviceUsed = 0;
    let total = 0;
    for (const r of rows) {
      const c = computeCost([r], rates, serviceUsed);
      serviceUsed = c.serviceUsed;
      const cat = (r.pricingCategory ?? 'unknown').toLowerCase();
      byCategory[cat] ??= { count: 0, cost: 0 };
      byCategory[cat].count += 1;
      byCategory[cat].cost = round4(byCategory[cat].cost + c.total);
      total += c.total;
      if (r.campaignId) {
        const pc = perCampaign.get(r.campaignId) ?? { count: 0, cost: 0 };
        pc.count += 1;
        pc.cost = round4(pc.cost + c.total);
        perCampaign.set(r.campaignId, pc);
      }
    }
    const names = perCampaign.size ? await this.prisma.campaign.findMany({ where: { id: { in: [...perCampaign.keys()] } }, select: { id: true, name: true } }) : [];
    return {
      month,
      currency: rates.currency || 'EUR',
      total: round4(total),
      byCategory,
      byCampaign: [...perCampaign.entries()]
        .map(([campaignId, v]) => ({ campaignId, name: names.find((n) => n.id === campaignId)?.name ?? 'Campaña', ...v }))
        .sort((a, b) => b.cost - a.cost),
      freeServiceUsed: serviceUsed,
      freeServiceLimit: rates.freeServicePerMonth,
    };
  }

  /** Datos para /api/status */
  async statusSnapshot() {
    const snap = await this.latestSnapshot();
    return { quality: snap ? normRating(snap.qualityRating) : ('UNKNOWN' as QualityRating), phoneStatus: snap?.phoneStatus ?? null, messagingLimit: snap?.messagingLimit ?? null };
  }

  statusToken() {
    return config().STATUS_TOKEN;
  }
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

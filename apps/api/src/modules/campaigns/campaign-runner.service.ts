import { ConflictException, HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { templateVariableKeys, type TemplateComponent, type VariableSource } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DomainEvents } from '../events/domain-events.service';
import { JobsService, QUEUES } from '../jobs/jobs.service';
import { SettingsService } from '../settings/settings.service';
import { MessagingService } from '../whatsapp/messaging.service';
import { contactDisplayName } from '../inbox/mappers';
import { AudienceService } from './audience.service';
import { CampaignProgressService } from './campaign-progress.service';
import { CampaignClock } from './campaigns.clock';
import { audienceSchema } from '@gelado/shared';

const MINUTE_GUARD_MS = 55_000;

interface ContactFields {
  firstName: string | null;
  lastName: string | null;
  profileName: string | null;
  company: string | null;
  customerCode: string | null;
  phoneE164: string;
}

/** Valor de cada variable de la plantilla para un contacto (campo con respaldo o texto fijo). */
export function resolveParams(keys: string[], mapping: Record<string, VariableSource>, contact: ContactFields): { params: Record<string, string>; missing: string[] } {
  const params: Record<string, string> = {};
  const missing: string[] = [];
  for (const k of keys) {
    const src = mapping[k];
    let v = '';
    if (src) {
      if ('text' in src) v = src.text;
      else {
        const raw = src.field === 'displayName' ? contactDisplayName(contact) : (contact as unknown as Record<string, string | null>)[src.field];
        v = (raw ?? '').trim() || src.fallback || '';
      }
    }
    v = v.trim();
    if (!v) missing.push(k);
    params[k] = v;
  }
  return { params, missing };
}

/**
 * Motor de envío: arranca campañas (materializa destinatarios), envía escalonado respetando ritmo y límite de 24 h,
 * pausa/reanuda/cancela y para solo ante errores graves. Nunca duplica: cada destinatario se reclama con un
 * UPDATE atómico QUEUED → SENDING y se comprueba si ya existe su mensaje antes de enviar.
 */
@Injectable()
export class CampaignRunnerService implements OnModuleInit {
  private readonly log = new Logger('CampaignRunner');
  private ticking = false;
  private lastDispatch = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly events: DomainEvents,
    private readonly messaging: MessagingService,
    private readonly settings: SettingsService,
    private readonly audience: AudienceService,
    private readonly progress: CampaignProgressService,
    private readonly audit: AuditService,
    private readonly clock: CampaignClock,
  ) {}

  onModuleInit() {
    this.jobs.register(QUEUES.CRON_MINUTE, () => this.tick(), {}, 'campaign-dispatch');
    this.jobs.register<{ recipientId: string }>(QUEUES.CAMPAIGN_SEND, (d) => this.sendOne(d.recipientId));
    this.jobs.register<{ campaignId?: string }>(QUEUES.CAMPAIGN_DISPATCH, (d) => this.tick(d?.campaignId));

    this.events.on('sending.blocked', 'campaigns-stop', async (p) => {
      const reason = `Parada automática: ${p.message} (error ${p.code}).`;
      if (p.scope === 'all') {
        await this.stopWhere({ status: 'RUNNING' }, reason + ' Revisa la cuenta en Meta antes de reanudar.', 'PAUSED');
      } else if (p.campaignId) {
        await this.stopWhere({ id: p.campaignId, status: { in: ['RUNNING', 'SCHEDULED'] } }, reason, p.code === 132001 ? 'FAILED' : 'PAUSED');
      } else if (p.templateId) {
        await this.stopWhere({ templateId: p.templateId, status: { in: ['RUNNING', 'SCHEDULED'] } }, reason, p.code === 132001 ? 'FAILED' : 'PAUSED');
      }
    });
    this.events.on('template.status', 'campaigns-stop', async (p) => {
      if (!['PAUSED', 'DISABLED', 'REJECTED', 'DELETED'].includes(p.status)) return;
      const why = p.status === 'PAUSED' ? 'está pausada por baja calidad' : p.status === 'REJECTED' ? 'ha sido rechazada' : p.status === 'DELETED' ? 'se ha borrado' : 'está desactivada';
      await this.stopWhere({ templateId: p.templateId, status: { in: ['RUNNING', 'SCHEDULED'] } }, `Parada automática: la plantilla «${p.name}» ${why} en Meta.`, 'PAUSED');
    });
    this.events.on('phone.quality', 'campaigns-stop', async (p) => {
      if ((p.qualityRating ?? '').toUpperCase() !== 'RED') return;
      await this.stopWhere({ status: 'RUNNING' }, 'Parada automática: la calidad del número ha bajado a rojo. Revisa la calidad antes de reanudar.', 'PAUSED');
    });
  }

  // ───────────────────────── Paradas automáticas ─────────────────────────

  async stopWhere(where: Prisma.CampaignWhereInput, reason: string, status: 'PAUSED' | 'FAILED') {
    const list = await this.prisma.campaign.findMany({ where, select: { id: true } });
    for (const c of list) {
      const u = await this.prisma.campaign.updateMany({
        where: { id: c.id, status: { in: ['RUNNING', 'SCHEDULED'] } },
        data: { status, stopReason: reason, ...(status === 'FAILED' ? { completedAt: this.clock.now() } : {}) },
      });
      if (!u.count) continue;
      await this.audit.log({ action: 'pause_campaign', entityType: 'Campaign', entityId: c.id, data: { auto: true, reason, status } });
      await this.progress.recompute(c.id);
    }
  }

  // ───────────────────────── Arranque ─────────────────────────

  /**
   * Pasa DRAFT/SCHEDULED → RUNNING y materializa los destinatarios en una transacción. Idempotente:
   * si otro proceso ya la arrancó no hace nada. Los excluidos quedan SKIPPED con su motivo.
   */
  async start(campaignId: string): Promise<boolean> {
    const camp = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!camp) return false;
    const aud = audienceSchema.parse(camp.audience);
    const [rows, defaults] = await Promise.all([this.audience.resolve(aud), this.settings.get('campaign_defaults')]);
    const receivers = rows.filter((r) => !r.excluded);
    const now = this.clock.now();
    const used = await this.audience.usedLast24h(now);
    const batches = this.audience.planBatches(receivers.length, defaults.dailyLimit, used, now);

    const started = await this.prisma.$transaction(
      async (tx) => {
        const u = await tx.campaign.updateMany({
          where: { id: campaignId, status: { in: ['DRAFT', 'SCHEDULED'] } },
          data: { status: 'RUNNING', startedAt: now, stopReason: null },
        });
        if (!u.count) return false;
        const data: Prisma.CampaignRecipientCreateManyInput[] = [];
        let i = 0;
        for (const b of batches) {
          for (let n = 0; n < b.count; n++, i++) {
            const r = receivers[i]!;
            data.push({ campaignId, contactId: r.contactId, phoneE164: r.phoneE164, plannedFor: b.at });
          }
        }
        for (const r of rows) {
          if (r.excluded && r.excluded !== 'EXCLUDED_LABEL') {
            data.push({ campaignId, contactId: r.contactId, phoneE164: r.phoneE164, status: 'SKIPPED', skipReason: r.excluded });
          }
        }
        for (let k = 0; k < data.length; k += 1000) await tx.campaignRecipient.createMany({ data: data.slice(k, k + 1000), skipDuplicates: true });
        return true;
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
    if (started) await this.progress.recompute(campaignId);
    return started;
  }

  // ───────────────────────── Pausa, reanudación, cancelación ─────────────────────────

  async pause(campaignId: string): Promise<void> {
    const u = await this.prisma.campaign.updateMany({ where: { id: campaignId, status: { in: ['RUNNING', 'SCHEDULED'] } }, data: { status: 'PAUSED', stopReason: null } });
    if (!u.count) throw new ConflictException({ statusCode: 409, message: 'Solo se puede pausar una campaña en curso o programada' });
    await this.progress.recompute(campaignId);
  }

  async resume(campaignId: string): Promise<void> {
    const c = await this.prisma.campaign.findUnique({ where: { id: campaignId }, include: { template: true } });
    if (!c || c.status !== 'PAUSED') throw new ConflictException({ statusCode: 409, message: 'Solo se puede reanudar una campaña pausada' });
    if (c.template.status !== 'APPROVED') {
      throw new ConflictException({ statusCode: 409, message: `La plantilla «${c.template.displayName ?? c.template.name}» no está aprobada por Meta: no se puede reanudar` });
    }
    const next = c.startedAt ? 'RUNNING' : 'SCHEDULED';
    await this.prisma.campaign.update({ where: { id: campaignId }, data: { status: next, stopReason: null } });
    if (next === 'RUNNING') {
      // Destinatarios que se estaban enviando al pausar y de los que no llegó a crearse mensaje: vuelven a la cola
      const stuck = await this.prisma.campaignRecipient.findMany({ where: { campaignId, status: 'SENDING', messageId: null }, select: { id: true, contactId: true } });
      for (const s of stuck) {
        const msg = await this.prisma.message.findFirst({ where: { campaignId, conversation: { contactId: s.contactId } }, select: { id: true } });
        if (!msg) await this.prisma.campaignRecipient.updateMany({ where: { id: s.id, status: 'SENDING', messageId: null }, data: { status: 'QUEUED' } });
      }
    }
    await this.progress.recompute(campaignId);
  }

  async cancel(campaignId: string): Promise<void> {
    const u = await this.prisma.campaign.updateMany({
      where: { id: campaignId, status: { in: ['RUNNING', 'PAUSED', 'SCHEDULED'] } },
      data: { status: 'CANCELLED', completedAt: this.clock.now(), stopReason: null },
    });
    if (!u.count) throw new ConflictException({ statusCode: 409, message: 'Solo se puede cancelar una campaña programada, en curso o pausada' });
    await this.progress.recompute(campaignId);
  }

  // ───────────────────────── Envío escalonado ─────────────────────────

  /** Arranca las programadas que ya tocan y envía un minuto de cada campaña en curso. */
  async tick(onlyCampaignId?: string): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.clock.now();
      if (!onlyCampaignId) {
        const due = await this.prisma.campaign.findMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: now } }, select: { id: true } });
        for (const d of due) {
          const tpl = await this.prisma.campaign.findUnique({ where: { id: d.id }, include: { template: true } });
          if (tpl && tpl.template.status !== 'APPROVED') {
            await this.stopWhere({ id: d.id }, `Parada automática: la plantilla «${tpl.template.displayName ?? tpl.template.name}» ya no está aprobada.`, 'PAUSED');
            continue;
          }
          await this.start(d.id);
        }
      }
      const running = await this.prisma.campaign.findMany({
        where: { status: 'RUNNING', ...(onlyCampaignId ? { id: onlyCampaignId } : {}) },
        include: { template: { select: { status: true, name: true, displayName: true } } },
        orderBy: { startedAt: 'asc' },
      });
      if (!running.length) return;
      const defaults = await this.settings.get('campaign_defaults');
      let room = defaults.dailyLimit - (await this.audience.usedLast24h(now));
      for (const c of running) {
        if (c.template.status !== 'APPROVED') {
          await this.stopWhere({ id: c.id }, `Parada automática: la plantilla «${c.template.displayName ?? c.template.name}» ya no está aprobada por Meta.`, 'PAUSED');
          continue;
        }
        const last = this.lastDispatch.get(c.id);
        if (last != null && now.getTime() >= last && now.getTime() - last < MINUTE_GUARD_MS) continue; // ya se envió este minuto
        const n = Math.min(c.ratePerMinute, Math.max(0, room));
        let claimed: string[] = [];
        if (n > 0) claimed = await this.claim(c.id, n, now);
        this.lastDispatch.set(c.id, now.getTime());
        room -= claimed.length;
        for (const id of claimed) await this.jobs.send(QUEUES.CAMPAIGN_SEND, { recipientId: id }, { retryLimit: 3, retryDelay: 10, retryBackoff: true });
        await this.progress.recompute(c.id); // completa la campaña si ya no queda nada
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Reclama hasta `n` destinatarios vencidos (QUEUED → SENDING) de forma atómica: dos procesos nunca reciben el mismo. */
  private async claim(campaignId: string, n: number, now: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE "CampaignRecipient" SET "status" = 'SENDING'
      WHERE "id" IN (
        SELECT "id" FROM "CampaignRecipient"
        WHERE "campaignId" = ${campaignId}::uuid AND "status" = 'QUEUED' AND ("plannedFor" IS NULL OR "plannedFor" <= ${now})
        ORDER BY "plannedFor" ASC NULLS FIRST, "id" ASC
        LIMIT ${n} FOR UPDATE SKIP LOCKED)
      RETURNING "id"`);
    return rows.map((r) => r.id);
  }

  /** Worker de `campaign-send`: un destinatario. Idempotente (si ya tiene mensaje, solo sincroniza). */
  async sendOne(recipientId: string): Promise<void> {
    const r = await this.prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      include: { campaign: true, contact: { include: { conversation: { select: { id: true } } } } },
    });
    if (!r || r.status !== 'SENDING') return;
    const { campaign, contact } = r;
    const requeue = () => this.prisma.campaignRecipient.updateMany({ where: { id: r.id, status: 'SENDING', messageId: null }, data: { status: 'QUEUED' } });

    // ¿Ya se creó su mensaje (reintento tras un fallo a medias)? Nunca se envía dos veces.
    const existing = await this.prisma.message.findFirst({ where: { campaignId: campaign.id, conversation: { contactId: contact.id }, direction: 'OUTBOUND', kind: 'TEMPLATE' }, orderBy: { createdAt: 'desc' } });
    if (existing) {
      await this.progress.syncFromMessage(r.id, existing);
      await this.progress.recompute(campaign.id);
      return;
    }
    if (campaign.status !== 'RUNNING') {
      await requeue();
      return;
    }
    // Reglas de baja: se comprueban justo antes de enviar (puede haberse dado de baja tras lanzar la campaña)
    const skip = contact.deletedAt ? 'DELETED' : contact.consentStatus === 'REVOKED' ? 'REVOKED' : contact.phoneInvalid ? 'PHONE_INVALID' : null;
    if (skip) {
      await this.prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: 'SKIPPED', skipReason: skip } });
      await this.progress.recompute(campaign.id);
      return;
    }

    const template = await this.prisma.template.findUniqueOrThrow({ where: { id: campaign.templateId } });
    const keys = templateVariableKeys(template.components as unknown as TemplateComponent[]);
    const { params, missing } = resolveParams(keys, (campaign.variableMapping ?? {}) as Record<string, VariableSource>, contact);
    if (missing.length) {
      await this.fail(r.id, null, `Falta un dato del contacto para la variable ${missing.join(', ')} y no hay texto de respaldo`);
      await this.progress.recompute(campaign.id);
      return;
    }
    try {
      const conv = contact.conversation ?? (await this.messaging.ensureConversationForContact(contact.id));
      const msg = await this.messaging.sendTemplate(conv.id, campaign.templateId, params, { headerMediaFileId: campaign.headerMediaId, campaignId: campaign.id });
      await this.progress.syncFromMessage(r.id, msg);
    } catch (e) {
      if (e instanceof HttpException) {
        // Rechazo definitivo (validación, plantilla no aprobada…): no se reintenta
        const body = e.getResponse() as { message?: string } | string;
        const text = typeof body === 'string' ? body : (body.message ?? e.message);
        if (e.getStatus() === 409 && template.status !== 'APPROVED') await requeue();
        else await this.fail(r.id, null, text);
      } else {
        throw e; // error inesperado: pg-boss reintenta (el comprobante de mensaje existente evita duplicar)
      }
    }
    await this.progress.recompute(campaign.id);
  }

  private async fail(recipientId: string, code: number | null, title: string) {
    await this.prisma.campaignRecipient.update({ where: { id: recipientId }, data: { status: 'FAILED', errorCode: code, errorTitle: title } });
  }
}

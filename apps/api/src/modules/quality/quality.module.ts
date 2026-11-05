import { Module, OnModuleInit } from '@nestjs/common';
import { DomainEvents } from '../events/domain-events.service';
import { JobsService, QUEUES } from '../jobs/jobs.service';
import { WebhookFieldRouter } from '../webhooks/webhook-field-router';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AlertsService } from './alerts.service';
import { AutoReplyService } from './auto-reply.service';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';

/** S7 · Calidad, límites, alertas (banner y /api/status), costes y respuestas automáticas. */
@Module({
  imports: [WhatsAppModule],
  controllers: [QualityController],
  providers: [QualityService, AlertsService, AutoReplyService],
  exports: [QualityService, AlertsService, AutoReplyService],
})
export class QualityModule implements OnModuleInit {
  constructor(
    private readonly router: WebhookFieldRouter,
    private readonly events: DomainEvents,
    private readonly jobs: JobsService,
    private readonly quality: QualityService,
    private readonly autoReply: AutoReplyService,
  ) {}

  onModuleInit() {
    this.router.on('phone_number_quality_update', 'quality', (v) => this.quality.handlePhoneQualityUpdate(v));
    this.router.on('account_update', 'quality', (v) => this.quality.handleAccountUpdate(v));
    this.events.on('account.update', 'quality-alerts', (p) => this.quality.onAccountUpdate(p as any));
    this.events.on('sending.blocked', 'quality-alerts', (p) => this.quality.onSendingBlocked(p));
    this.events.on('template.status', 'quality-alerts', (p) => this.quality.onTemplateStatus(p));
    this.events.on('inbound.message', 'auto-reply', (p) => this.autoReply.onInbound(p));
    this.jobs.register(QUEUES.CRON_HOURLY, async () => void (await this.quality.poll()), {}, 'quality-poll');
  }
}

import { Module, OnModuleInit } from '@nestjs/common';
import { JobsService, QUEUES, type QueueName } from '../jobs/jobs.service';
import { WebhookFieldRouter } from '../webhooks/webhook-field-router';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/** S3 · Plantillas: sincronización, editor, envío a revisión (Resumable Upload), estados por webhook. */
@Module({ controllers: [TemplatesController], providers: [TemplatesService], exports: [TemplatesService] })
export class TemplatesModule implements OnModuleInit {
  constructor(
    private readonly templates: TemplatesService,
    private readonly router: WebhookFieldRouter,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.router.on('message_template_status_update', 'templates', (v) => this.templates.handleStatusUpdate(v));
    this.router.on('message_template_quality_update', 'templates', (v) => this.templates.handleQualityUpdate(v));
    this.router.on('template_category_update', 'templates', (v) => this.templates.handleCategoryUpdate(v));
    // Sincronización horaria (cron-hourly admite varios handlers)
    this.jobs.register(QUEUES.CRON_HOURLY, async () => void (await this.templates.sync()), {}, 'templates-sync');
  }
}

import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma.service';
import { AuditModule } from './modules/audit/audit.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { RealtimeModule } from './modules/realtime/realtime.gateway';
import { StorageModule } from './modules/storage/storage.service';
import { DomainEventsModule } from './modules/events/domain-events.service';
import { SettingsModule } from './modules/settings/settings.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WebhookFieldRouterModule } from './modules/webhooks/webhook-field-router';
import { MediaModule } from './modules/media/media.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { LabelsModule } from './modules/labels/labels.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { LibraryModule } from './modules/library/library.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { QualityModule } from './modules/quality/quality.module';

@Module({
  imports: [
    // Base (F0)
    PrismaModule, AuditModule, AuthModule, UsersModule, HealthModule, JobsModule, RealtimeModule, StorageModule, DomainEventsModule, SettingsModule, WebhookFieldRouterModule,
    // Módulos funcionales (un dueño cada uno, ver docs/plan de trabajo)
    WhatsAppModule, WebhooksModule, MediaModule, ContactsModule, LabelsModule, InboxModule, LibraryModule, TemplatesModule, CampaignsModule, QualityModule,
  ],
})
export class AppModule {}

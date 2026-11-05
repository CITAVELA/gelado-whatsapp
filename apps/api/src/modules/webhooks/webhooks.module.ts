import { Module } from '@nestjs/common';
import { InboundMediaService } from './inbound-media.service';
import { InboundMessagesService } from './inbound-messages.service';
import { WebhookIngestService } from './webhook-ingest.service';
import { WebhooksController } from './webhooks.controller';

/** S1 · Webhook de Meta: verificación GET, firma, persistencia cruda (WebhookEvent), cola wa-inbound, procesado. */
@Module({
  controllers: [WebhooksController],
  providers: [WebhookIngestService, InboundMessagesService, InboundMediaService],
})
export class WebhooksModule {}

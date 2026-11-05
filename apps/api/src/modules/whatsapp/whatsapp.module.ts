import { Global, Module } from '@nestjs/common';
import { WhatsAppGateway } from './whatsapp.gateway';
import { MessagingService } from './messaging.service';
import { MessageNotifier } from './message-notifier.service';
import { MessageStatusService } from './message-status.service';

/** S1 · WhatsApp núcleo: cliente Graph API, envíos (MessagingService), estados y mapeo de errores. */
@Global()
@Module({
  providers: [WhatsAppGateway, MessagingService, MessageNotifier, MessageStatusService],
  exports: [WhatsAppGateway, MessagingService, MessageNotifier, MessageStatusService],
})
export class WhatsAppModule {}

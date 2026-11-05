import { Global, Module } from '@nestjs/common';
import { WhatsAppGateway } from './whatsapp.gateway';

/** S1 · WhatsApp núcleo: cliente Graph API, envíos (MessagingService), mapeo de errores. */
@Global()
@Module({ providers: [WhatsAppGateway], exports: [WhatsAppGateway] })
export class WhatsAppModule {}

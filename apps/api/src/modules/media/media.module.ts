import { Global, Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

/** S1 · Media: subida a Storage, URLs firmadas, subida a WhatsApp, conversión de notas de voz (OGG/Opus). */
@Global()
@Module({ providers: [MediaService], controllers: [MediaController], exports: [MediaService] })
export class MediaModule {}

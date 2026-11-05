import { BadRequestException, Controller, Get, HttpException, Injectable, Param, ParseUUIDPipe, PayloadTooLargeException, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { validateMediaForWhatsApp, type MediaDto } from '@gelado/shared';
import { CurrentUser, type AuthUser } from '../../common/decorators';
import { MediaService } from './media.service';
import { normalizeUploadMime } from './mime';

const MAX_UPLOAD = 100 * 1024 * 1024; // el mayor límite de Meta (documentos)

/** multer en memoria; sus errores se traducen al español. */
@Injectable()
export class UploadInterceptor extends FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD, files: 1 } }) {
  async intercept(ctx: any, next: any) {
    try {
      return await super.intercept(ctx, next);
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === 413) {
        throw new PayloadTooLargeException({ statusCode: 413, message: 'El archivo supera el máximo de 100 MB' });
      }
      if (e instanceof HttpException) throw new BadRequestException({ statusCode: 400, message: 'No se pudo leer el archivo subido' });
      throw e;
    }
  }
}

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException({ statusCode: 400, message: 'Identificador no válido' }) });

@Controller('api/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** Sube un archivo (multipart, campo `file`). Valida tipo y tamaño con las reglas de WhatsApp. */
  @Post()
  @UseInterceptors(UploadInterceptor)
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() me: AuthUser): Promise<MediaDto> {
    if (!file) throw new BadRequestException({ statusCode: 400, message: 'Falta el archivo (campo «file»)' });
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8'); // multer entrega el nombre en latin1
    // sin parámetros (`audio/webm;codecs=opus` → `audio/webm`) y con alias (`audio/x-m4a` → `audio/mp4`)
    const mime = normalizeUploadMime(file.mimetype);
    const check = validateMediaForWhatsApp(mime, file.size);
    if (!check.ok) throw new BadRequestException({ statusCode: 400, message: check.reason });
    if (!file.size) throw new BadRequestException({ statusCode: 400, message: 'El archivo está vacío' });
    const m = await this.media.storeBuffer(file.buffer, mime, fileName, 'UPLOAD', me.id);
    return this.media.toDto(m);
  }

  /** URL firmada de 1 h para ver o descargar el archivo. */
  @Get(':id/url')
  async url(@Param('id', uuidPipe) id: string): Promise<{ url: string }> {
    const m = await this.media.get(id);
    return { url: await this.media.signedUrl(m) };
  }
}

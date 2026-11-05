import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MediaFile } from '@prisma/client';
import type { MediaDto, MediaSource } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { sha256 } from '../../common/tokens';
import { StorageService, buildObjectPath, SIGNED_URL_TTL } from '../storage/storage.service';
import { WhatsAppGateway } from '../whatsapp/whatsapp.gateway';
import { convertToOggOpusMono } from './audio-convert';
import { baseMime, extFor } from './mime';

/** Los ids de media de WhatsApp caducan a los 30 días: se guardan 29 y se renuevan con 1 día de margen. */
const WA_MEDIA_TTL_MS = 29 * 24 * 3600 * 1000;
const WA_MEDIA_MARGIN_MS = 24 * 3600 * 1000;

/**
 * Archivos: guardado en Storage, URLs firmadas (1 h), subida a WhatsApp reutilizando el id mientras no caduque
 * y conversión de notas de voz a OGG/Opus mono.
 */
@Injectable()
export class MediaService {
  private readonly log = new Logger('Media');
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly gateway: WhatsAppGateway) {}

  /** Guarda un buffer en Storage y crea el MediaFile. */
  async storeBuffer(buffer: Buffer, mime: string, fileName: string | null, source: MediaSource, userId?: string | null): Promise<MediaFile> {
    const mimeType = baseMime(mime) || 'application/octet-stream';
    const storagePath = buildObjectPath(extFor(mimeType, fileName));
    await this.storage.upload(storagePath, buffer, { contentType: mimeType });
    return this.prisma.mediaFile.create({
      data: { storagePath, mimeType, sizeBytes: buffer.length, fileName: fileName?.slice(0, 200) || null, sha256: sha256(buffer), source, createdById: userId ?? null },
    });
  }

  /** URL firmada de 1 h. Es una propiedad (función flecha) para poder pasarla tal cual como `MediaUrlResolver`. */
  signedUrl = async (m: { storagePath: string; fileName?: string | null }): Promise<string> => this.storage.createSignedUrl(m.storagePath, SIGNED_URL_TTL);

  async toDto(m: MediaFile): Promise<MediaDto> {
    return { id: m.id, mimeType: m.mimeType, sizeBytes: m.sizeBytes, fileName: m.fileName, url: await this.signedUrl(m) };
  }

  async get(id: string): Promise<MediaFile> {
    const m = await this.prisma.mediaFile.findUnique({ where: { id } });
    if (!m) throw new NotFoundException({ statusCode: 404, message: 'Archivo no encontrado' });
    return m;
  }

  /** Contenido del archivo guardado. */
  read(m: { storagePath: string }): Promise<Buffer> {
    return this.storage.download(m.storagePath);
  }

  /** Id de media de WhatsApp válido para el archivo: lo reutiliza o lo sube de nuevo si falta o está a punto de caducar. */
  async ensureWaMediaId(mediaFileId: string): Promise<string> {
    const m = await this.get(mediaFileId);
    if (m.waMediaId && m.waMediaIdExpiresAt && m.waMediaIdExpiresAt.getTime() > Date.now() + WA_MEDIA_MARGIN_MS) return m.waMediaId;
    const data = await this.storage.download(m.storagePath);
    const { id } = await this.gateway.uploadMedia(data, m.mimeType, m.fileName ?? `archivo.${extFor(m.mimeType)}`);
    await this.prisma.mediaFile.update({ where: { id: m.id }, data: { waMediaId: id, waMediaIdExpiresAt: new Date(Date.now() + WA_MEDIA_TTL_MS) } });
    return id;
  }

  /** Nota de voz → nuevo MediaFile OGG/Opus mono (el original se conserva). */
  async convertVoice(mediaFileId: string, userId?: string | null): Promise<MediaFile> {
    const src = await this.get(mediaFileId);
    try {
      const input = await this.storage.download(src.storagePath);
      const out = await convertToOggOpusMono(input, src.mimeType);
      const base = (src.fileName ?? 'nota-de-voz').replace(/\.[a-z0-9]{1,5}$/i, '');
      return await this.storeBuffer(out, 'audio/ogg', `${base}.ogg`, 'UPLOAD', userId ?? src.createdById);
    } catch (e) {
      this.log.error(`No se pudo convertir la nota de voz ${mediaFileId}: ${(e as Error).message}`);
      throw new BadRequestException({ statusCode: 400, message: 'No se pudo procesar la nota de voz. Grábala de nuevo.' });
    }
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sha256 } from '../../common/tokens';
import { PrismaService } from '../../common/prisma.service';
import { JobsService, QUEUES } from '../jobs/jobs.service';
import { MediaService } from '../media/media.service';
import { extFor } from '../media/mime';
import { MessageNotifier } from '../whatsapp/message-notifier.service';
import { WhatsAppApiError, WhatsAppGateway } from '../whatsapp/whatsapp.gateway';

/** Descarga de adjuntos entrantes (cola `wa-media-download`): Meta → Storage → MediaFile → Message.mediaId. */
@Injectable()
export class InboundMediaService implements OnModuleInit {
  private readonly log = new Logger('InboundMedia');
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly gateway: WhatsAppGateway,
    private readonly media: MediaService,
    private readonly notifier: MessageNotifier,
  ) {}

  onModuleInit() {
    this.jobs.register<{ messageId: string }>(QUEUES.WA_MEDIA_DOWNLOAD, (d) => this.download(d.messageId));
  }

  async download(messageId: string): Promise<void> {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg || msg.mediaId) return; // ya descargado: idempotente
    const p = (msg.payload ?? {}) as { waMediaId?: string; mimeType?: string; fileName?: string | null; sha256?: string | null };
    if (!p.waMediaId) return;

    // La URL que da Meta caduca en minutos: si la descarga da 404, se pide la información de nuevo
    let file: { data: Buffer; mimeType: string } | null = null;
    let info: Awaited<ReturnType<WhatsAppGateway['getMediaInfo']>> | null = null;
    let lastErr: unknown;
    for (let i = 0; i < 3 && !file; i++) {
      try {
        info = await this.gateway.getMediaInfo(p.waMediaId);
        file = await this.gateway.downloadMedia(info.url);
      } catch (e) {
        lastErr = e;
        if (e instanceof WhatsAppApiError && e.httpStatus === 404 && info) continue; // URL caducada → pedir otra
        throw e;
      }
    }
    if (!file || !info) throw lastErr ?? new Error('No se pudo descargar el adjunto');

    if (p.sha256 && info.sha256 && p.sha256 !== info.sha256) this.log.warn(`sha256 distinto en ${p.waMediaId}`);
    const mime = (info.mime_type || p.mimeType || file.mimeType).split(';')[0]!;
    const fileName = p.fileName || `${msg.kind.toLowerCase()}-${msg.id.slice(0, 8)}.${extFor(mime)}`;
    const stored = await this.media.storeBuffer(file.data, mime, fileName, 'INBOUND', null);
    // Guardar también el id de WhatsApp: el archivo recibido podría reenviarse sin subirlo
    await this.prisma.mediaFile.update({ where: { id: stored.id }, data: { sha256: sha256(file.data) } });
    await this.prisma.message.update({ where: { id: msg.id }, data: { mediaId: stored.id } });

    await this.notifier.created(msg.id, false); // refresca la burbuja (ya no está «pendiente»)
    await this.notifier.conversation(msg.conversationId);
  }
}

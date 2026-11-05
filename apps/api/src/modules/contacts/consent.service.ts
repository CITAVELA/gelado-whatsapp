import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ConsentSource, ConsentStatus } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { DomainEvents } from '../events/domain-events.service';
import { MessageNotifier } from '../whatsapp/message-notifier.service';

/**
 * Única puerta para cambiar el consentimiento (regla 5 de 05):
 * - cada cambio deja un ConsentEvent con origen (y usuario si es manual);
 * - salir de REVOKED exige origen y usuario (no se reactiva solo).
 * - una baja emite `contact.opted_out` y deja evento CONSENT_CHANGED en la conversación.
 * - cada cambio avisa por WebSocket (`event.created` y `conversation.updated`) para que la bandeja lo vea al momento.
 */
@Injectable()
export class ConsentService {
  private readonly log = new Logger('Consent');

  constructor(private readonly prisma: PrismaService, private readonly events: DomainEvents, private readonly notifier: MessageNotifier) {}

  async setConsent(
    contactId: string,
    status: ConsentStatus,
    source: ConsentSource,
    opts: { userId?: string | null; note?: string | null; messageId?: string | null; campaignId?: string | null } = {},
  ): Promise<{ changed: boolean }> {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId }, include: { conversation: { select: { id: true } } } });
    if (!contact) throw new BadRequestException({ statusCode: 400, message: 'Contacto no encontrado' });
    if (contact.consentStatus === status) return { changed: false };
    if (contact.consentStatus === 'REVOKED' && status !== 'REVOKED' && !opts.userId) {
      throw new BadRequestException({ statusCode: 400, message: 'Para reactivar a un contacto dado de baja hace falta un usuario y un origen' });
    }
    const now = new Date();
    let eventId = null as string | null;
    await this.prisma.$transaction(async (tx) => {
      await tx.contact.update({ where: { id: contactId }, data: { consentStatus: status, consentAt: now } });
      await tx.consentEvent.create({
        data: { contactId, status, source, note: opts.note ?? null, userId: opts.userId ?? null, messageId: opts.messageId ?? null },
      });
      if (contact.conversation) {
        const ev = await tx.conversationEvent.create({
          data: { conversationId: contact.conversation.id, type: 'CONSENT_CHANGED', actorId: opts.userId ?? null, data: { from: contact.consentStatus, to: status, source } },
        });
        eventId = ev.id;
      }
    });
    if (eventId && contact.conversation) {
      // el aviso en tiempo real nunca debe romper el cambio de consentimiento (ya está guardado)
      try {
        await this.notifier.event(eventId);
        await this.notifier.conversation(contact.conversation.id);
      } catch (e) {
        this.log.warn(`No se pudo avisar por WebSocket del cambio de consentimiento: ${(e as Error).message}`);
      }
    }
    if (status === 'REVOKED') await this.events.emit('contact.opted_out', { contactId, source, campaignId: opts.campaignId ?? null });
    return { changed: true };
  }
}

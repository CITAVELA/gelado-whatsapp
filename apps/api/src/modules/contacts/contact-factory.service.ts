import { Injectable } from '@nestjs/common';
import type { Contact, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { SUPPRESSED_NOTE, SuppressionService } from './suppression.service';

type Db = Pick<PrismaService, 'contact' | 'consentEvent' | 'suppressedPhone' | 'setting'>;

/**
 * ÚNICA puerta de alta de un contacto (alta manual, nueva conversación, prueba de campaña, mensaje entrante).
 * Si el teléfono está en la lista de supresión, el contacto nace ya REVOKED (origen MANUAL, nota «Suprimido
 * previamente») con su ConsentEvent, en la misma operación: nunca existe como UNKNOWN. Acepta una transacción.
 * La importación en bloque aplica la misma regla con `SuppressionService.suppressedAmong`.
 */
@Injectable()
export class ContactFactory {
  constructor(private readonly prisma: PrismaService, private readonly suppression: SuppressionService) {}

  async create(data: Prisma.ContactUncheckedCreateInput, opts: { db?: Db; userId?: string | null } = {}): Promise<Contact> {
    const db = opts.db ?? this.prisma;
    const suppressed = !!data.phoneE164 && (await this.suppression.isSuppressed(data.phoneE164, db));
    if (!suppressed) return db.contact.create({ data });
    const contact = await db.contact.create({ data: { ...data, consentStatus: 'REVOKED', consentAt: new Date() } });
    await db.consentEvent.create({ data: { contactId: contact.id, status: 'REVOKED', source: 'MANUAL', note: SUPPRESSED_NOTE, userId: opts.userId ?? null } });
    return contact;
  }
}

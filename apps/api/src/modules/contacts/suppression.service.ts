import { Injectable } from '@nestjs/common';
import { config } from '../../common/config';
import { PrismaService } from '../../common/prisma.service';
import { hmacSha256Hex } from '../../common/tokens';
import { ConsentService } from './consent.service';

export const SUPPRESSED_NOTE = 'Suprimido previamente';

/** Cliente de Prisma o transacción (lo único que necesita el servicio). */
type Db = Pick<PrismaService, 'suppressedPhone'>;

/**
 * Lista de supresión mínima (derecho de supresión + regla «un dado de baja nunca recibe marketing»).
 *
 * Al borrar físicamente un contacto se guarda solo el HMAC-SHA256 de su teléfono E.164 (clave = SESSION_SECRET,
 * así la lista no sirve para recuperar teléfonos). Si ese número vuelve —importación, mensaje entrante o alta
 * manual— el contacto nuevo nace REVOKED con origen MANUAL y la nota «Suprimido previamente».
 *
 * Quien cree contactos fuera de `modules/contacts` (p. ej. el procesador de entrantes) debe llamar a
 * `enforce(contactId, phoneE164)` justo después de crearlos.
 */
@Injectable()
export class SuppressionService {
  constructor(private readonly prisma: PrismaService, private readonly consent: ConsentService) {}

  hash(phoneE164: string): string {
    return hmacSha256Hex(config().SESSION_SECRET, phoneE164.trim());
  }

  /** Apunta el teléfono en la lista (idempotente). Acepta una transacción. */
  async add(phoneE164: string, db: Db = this.prisma): Promise<void> {
    await db.suppressedPhone.upsert({ where: { phoneHash: this.hash(phoneE164) }, create: { phoneHash: this.hash(phoneE164) }, update: {} });
  }

  async isSuppressed(phoneE164: string): Promise<boolean> {
    return (await this.prisma.suppressedPhone.count({ where: { phoneHash: this.hash(phoneE164) } })) > 0;
  }

  /** De una lista de teléfonos E.164, los que están suprimidos. */
  async suppressedAmong(phones: string[]): Promise<Set<string>> {
    const byHash = new Map(phones.map((p) => [this.hash(p), p]));
    const out = new Set<string>();
    const hashes = [...byHash.keys()];
    for (let i = 0; i < hashes.length; i += 5000) {
      const rows = await this.prisma.suppressedPhone.findMany({ where: { phoneHash: { in: hashes.slice(i, i + 5000) } }, select: { phoneHash: true } });
      for (const r of rows) out.add(byHash.get(r.phoneHash)!);
    }
    return out;
  }

  /** Si el número está suprimido, deja el contacto REVOKED (origen MANUAL, nota «Suprimido previamente»). Devuelve si lo hizo. */
  async enforce(contactId: string, phoneE164: string): Promise<boolean> {
    if (!(await this.isSuppressed(phoneE164))) return false;
    const r = await this.consent.setConsent(contactId, 'REVOKED', 'MANUAL', { note: SUPPRESSED_NOTE });
    return r.changed;
  }
}

import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma.service';
import { hmacSha256Hex } from '../../common/tokens';

export const SUPPRESSED_NOTE = 'Suprimido previamente';
/** Clave de `Setting` con la sal de la lista de supresión (aleatoria, se genera la primera vez y no cambia nunca). */
export const SUPPRESSION_SALT_KEY = 'suppression_salt';

/** Cliente de Prisma o transacción (lo único que necesita el servicio). */
type Db = Pick<PrismaService, 'suppressedPhone' | 'setting'>;

/**
 * Lista de supresión mínima (derecho de supresión + regla «un dado de baja nunca recibe marketing»).
 *
 * Al borrar físicamente un contacto se guarda solo el HMAC-SHA256 de su teléfono E.164. La clave es una sal aleatoria
 * propia (`Setting` «suppression_salt»), independiente de SESSION_SECRET: rotar el secreto de sesión no invalida la lista.
 * Si ese número vuelve —importación, mensaje entrante, alta manual, nueva conversación o prueba de campaña— el contacto
 * nuevo nace REVOKED con origen MANUAL y la nota «Suprimido previamente» (ver `ContactFactory`, la única puerta de alta).
 * Si una persona con usuario reactiva después al contacto (sale de REVOKED), su hash se quita de la lista.
 */
@Injectable()
export class SuppressionService {
  private saltPromise: Promise<string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Solo para pruebas: olvida la sal en memoria (la fuente de verdad es la BD). */
  resetCache() {
    this.saltPromise = null;
  }

  /** La sal se lee y se crea siempre con la conexión normal (nunca dentro de la transacción de quien llama). */
  private salt(): Promise<string> {
    this.saltPromise ??= this.loadSalt(this.prisma).catch((e) => {
      this.saltPromise = null;
      throw e;
    });
    return this.saltPromise;
  }

  private async loadSalt(db: Db): Promise<string> {
    const read = async () => ((await db.setting.findUnique({ where: { key: SUPPRESSION_SALT_KEY } }))?.value as { salt?: string } | null)?.salt;
    let salt = await read();
    if (!salt) {
      // dos arranques a la vez: gana el primero (skipDuplicates) y los dos releen el mismo valor
      await db.setting.createMany({ data: [{ key: SUPPRESSION_SALT_KEY, value: { salt: randomBytes(32).toString('hex') } }], skipDuplicates: true });
      salt = await read();
    }
    if (!salt) throw new Error('No se pudo obtener la sal de la lista de supresión');
    return salt;
  }

  async hash(phoneE164: string): Promise<string> {
    return hmacSha256Hex(await this.salt(), phoneE164.trim());
  }

  /** Apunta el teléfono en la lista (idempotente). Acepta una transacción. */
  async add(phoneE164: string, db: Db = this.prisma): Promise<void> {
    const phoneHash = await this.hash(phoneE164);
    await db.suppressedPhone.upsert({ where: { phoneHash }, create: { phoneHash }, update: {} });
  }

  /** Quita el teléfono de la lista (una persona lo reactivó a propósito). Idempotente. */
  async remove(phoneE164: string, db: Db = this.prisma): Promise<void> {
    await db.suppressedPhone.deleteMany({ where: { phoneHash: await this.hash(phoneE164) } });
  }

  async isSuppressed(phoneE164: string, db: Db = this.prisma): Promise<boolean> {
    return (await db.suppressedPhone.count({ where: { phoneHash: await this.hash(phoneE164) } })) > 0;
  }

  /** De una lista de teléfonos E.164, los que están suprimidos. */
  async suppressedAmong(phones: string[]): Promise<Set<string>> {
    const byHash = new Map<string, string>();
    for (const p of phones) byHash.set(await this.hash(p), p);
    const out = new Set<string>();
    const hashes = [...byHash.keys()];
    for (let i = 0; i < hashes.length; i += 5000) {
      const rows = await this.prisma.suppressedPhone.findMany({ where: { phoneHash: { in: hashes.slice(i, i + 5000) } }, select: { phoneHash: true } });
      for (const r of rows) out.add(byHash.get(r.phoneHash)!);
    }
    return out;
  }
}

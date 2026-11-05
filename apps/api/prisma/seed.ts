/**
 * Datos iniciales (docs/05 · seed). Idempotente: no pisa lo que ya existe (en especial privacy_policy).
 * Usuarios: se crean SIN contraseña y con enlace de invitación de un solo uso (se imprime en consola).
 * Solo en desarrollo, SEED_DEV_PASSWORD pone esa contraseña a los 3 usuarios para poder probar.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { DEFAULT_SETTINGS, INVITE_TTL_HOURS } from '@gelado/shared';

for (const f of [path.resolve(__dirname, '../../../.env'), path.resolve(__dirname, '../.env')]) {
  try {
    process.loadEnvFile(f);
    break;
  } catch {
    /* siguiente */
  }
}
const prisma = new PrismaClient();

const USERS = [
  { email: 'gelado.comercial@gmail.com', name: 'María Iborra', role: 'ADMIN' as const },
  { email: 'administracion2@gelado.eu', name: 'Cristina Lopez', role: 'AGENT' as const },
  { email: 'geladoexclusivas@gmail.com', name: 'Lolo Gelado', role: 'AGENT' as const },
];

const LABELS = [
  { name: 'PELUQUERÍA', color: '#2457C5', scope: 'CONTACT', showAsInboxView: true, sortOrder: 1 },
  { name: 'BARBERÍA', color: '#C2333A', scope: 'CONTACT', showAsInboxView: true, sortOrder: 2 },
  { name: 'ESTÉTICA', color: '#1E7A3D', scope: 'CONTACT', showAsInboxView: true, sortOrder: 3 },
  { name: 'INSTITUTO', color: '#B08A00', scope: 'CONTACT', showAsInboxView: true, sortOrder: 4 },
  { name: 'JUBILADO', color: '#6B737C', scope: 'CONTACT', showAsInboxView: true, sortOrder: 5 },
  { name: 'PEDIDO', color: '#1F5E33', scope: 'CONVERSATION', showAsInboxView: false, sortOrder: 1 },
  { name: 'FACTURA', color: '#C46A00', scope: 'CONVERSATION', showAsInboxView: false, sortOrder: 2 },
  { name: 'TRANSPORTE', color: '#3B33A6', scope: 'CONVERSATION', showAsInboxView: false, sortOrder: 3 },
] as const;

export function loadPrivacyMarkdown(): string {
  const candidates = [
    path.resolve(__dirname, '../../../docs/legal/politica-privacidad.md'),
    path.resolve(process.cwd(), 'docs/legal/politica-privacidad.md'),
    path.resolve(__dirname, 'politica-privacidad.md'),
  ];
  for (const f of candidates) {
    try {
      return readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->\s*/m, '').trim() + '\n';
    } catch {
      /* siguiente */
    }
  }
  return '# Política de privacidad\n\n[Texto pendiente]\n';
}

export async function seed(db: PrismaClient = prisma, opts: { quiet?: boolean } = {}) {
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const devPw = process.env.NODE_ENV !== 'production' ? process.env.SEED_DEV_PASSWORD : undefined;
  const links: string[] = [];

  for (const u of USERS) {
    let user = await db.user.findUnique({ where: { email: u.email } });
    if (!user) {
      user = await db.user.create({ data: { ...u, passwordHash: devPw ? await argon2.hash(devPw, { type: argon2.argon2id }) : '' } });
      if (!devPw) {
        const token = randomBytes(32).toString('base64url');
        await db.passwordResetToken.create({
          data: { userId: user.id, purpose: 'INVITE', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600e3) },
        });
        links.push(`${u.name} (${u.role}): ${appUrl}/crear-contrasena/${token}`);
      }
    }
  }

  for (const l of LABELS) {
    await db.label.upsert({ where: { name_scope: { name: l.name, scope: l.scope } }, create: { ...l }, update: {} });
  }

  const settings: Record<string, unknown> = {
    business_hours: DEFAULT_SETTINGS.business_hours,
    out_of_hours: DEFAULT_SETTINGS.out_of_hours,
    vacation: DEFAULT_SETTINGS.vacation,
    rates: DEFAULT_SETTINGS.rates,
    campaign_defaults: DEFAULT_SETTINGS.campaign_defaults,
    privacy_policy: { markdown: loadPrivacyMarkdown(), updatedAt: new Date().toISOString() },
  };
  for (const [key, value] of Object.entries(settings)) {
    const exists = await db.setting.findUnique({ where: { key } });
    if (!exists) await db.setting.create({ data: { key, value: value as Prisma.InputJsonValue } });
  }

  if (!opts.quiet) {
    console.log('Seed completado.');
    if (links.length) console.log('Enlaces de invitación (un solo uso, 7 días):\n  ' + links.join('\n  '));
    if (devPw) console.log(`Usuarios de desarrollo con contraseña SEED_DEV_PASSWORD.`);
  }
}

if (require.main === module) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

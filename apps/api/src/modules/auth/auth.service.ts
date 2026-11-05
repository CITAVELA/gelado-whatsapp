import { BadRequestException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { User } from '@prisma/client';
import { INVITE_TTL_HOURS, RESET_TTL_HOURS, type MeDto, type TokenInfoDto, type TokenLinkDto, type UserDto } from '@gelado/shared';
import { PrismaService } from '../../common/prisma.service';
import { randomToken, sha256 } from '../../common/tokens';
import { config } from '../../common/config';
import { AuditService } from '../audit/audit.service';
import { LoginRateLimiter } from './rate-limit';
import type { AuthUser } from '../../common/decorators';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SLIDE_AFTER_MS = 60 * 60 * 1000; // renueva la caducidad como mucho una vez por hora

@Injectable()
export class AuthService {
  readonly limiter = new LoginRateLimiter();
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  static toMe(u: Pick<User, 'id' | 'email' | 'name' | 'role'>): MeDto {
    return { id: u.id, email: u.email, name: u.name, role: u.role };
  }

  static toUserDto(u: User & { resetTokens?: { purpose: string; usedAt: Date | null; expiresAt: Date }[] }): UserDto {
    const now = Date.now();
    return {
      ...AuthService.toMe(u),
      active: u.active,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      hasPassword: !!u.passwordHash,
      pendingInvite: !u.passwordHash && !!u.resetTokens?.some((t) => t.purpose === 'INVITE' && !t.usedAt && t.expiresAt.getTime() > now),
    };
  }

  async hashPassword(pw: string) {
    return argon2.hash(pw, { type: argon2.argon2id });
  }

  async login(email: string, password: string, ip: string | null, userAgent: string | null) {
    const keys = [`ip:${ip ?? '?'}`, `u:${email}`];
    if (this.limiter.isBlocked(keys)) throw new HttpException({ statusCode: 429, message: 'Demasiados intentos. Espera 15 minutos y vuelve a probar.' }, 429);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = !!user && user.active && !!user.passwordHash && (await argon2.verify(user.passwordHash, password).catch(() => false));
    if (!ok) {
      this.limiter.fail(keys);
      await this.audit.log({ userId: user?.id, action: 'login_failed', data: { email }, ip });
      throw new UnauthorizedException({ statusCode: 401, message: 'Correo o contraseña incorrectos' });
    }
    this.limiter.reset(keys);
    const token = randomToken(32);
    await this.prisma.session.create({
      data: { userId: user!.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS), ip, userAgent: userAgent?.slice(0, 300) },
    });
    await this.prisma.user.update({ where: { id: user!.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ userId: user!.id, action: 'login', ip });
    return { token, user: AuthService.toMe(user!) };
  }

  /** Valida el token de la cookie; desliza la caducidad. */
  async validateSession(token: string | undefined): Promise<AuthUser | null> {
    if (!token) return null;
    const s = await this.prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!s || s.expiresAt.getTime() < Date.now() || !s.user.active) return null;
    if (Date.now() - s.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
      await this.prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
    }
    return { id: s.user.id, email: s.user.email, name: s.user.name, role: s.user.role, sessionId: s.id };
  }

  async logout(sessionId: string, userId: string, ip: string | null) {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
    await this.audit.log({ userId, action: 'logout', ip });
  }

  /** Genera un enlace de un solo uso (invitación o nueva contraseña). Invalida los anteriores del mismo tipo. */
  async createTokenLink(userId: string, purpose: 'INVITE' | 'RESET'): Promise<TokenLinkDto> {
    const token = randomToken(32);
    const hours = purpose === 'INVITE' ? INVITE_TTL_HOURS : RESET_TTL_HOURS;
    const expiresAt = new Date(Date.now() + hours * 3600 * 1000);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt } }),
    ]);
    return { url: `${config().APP_URL.replace(/\/$/, '')}/crear-contrasena/${token}`, expiresAt: expiresAt.toISOString(), purpose };
  }

  async tokenInfo(token: string): Promise<TokenInfoDto> {
    const t = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!t || t.usedAt || t.expiresAt.getTime() < Date.now() || !t.user.active) return { valid: false };
    return { valid: true, purpose: t.purpose, email: t.user.email, name: t.user.name };
  }

  async setPassword(token: string, password: string, ip: string | null) {
    const t = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!t || t.usedAt || t.expiresAt.getTime() < Date.now() || !t.user.active) {
      throw new BadRequestException({ statusCode: 400, message: 'El enlace no es válido o ha caducado. Pide uno nuevo a la administradora.' });
    }
    const passwordHash = await this.hashPassword(password);
    // Un solo uso: se marca usado en la misma transacción; se cierran las sesiones abiertas
    const res = await this.prisma.passwordResetToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
    if (res.count !== 1) throw new BadRequestException({ statusCode: 400, message: 'El enlace ya se ha usado.' });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: t.userId }, data: { passwordHash } }),
      this.prisma.session.deleteMany({ where: { userId: t.userId } }),
    ]);
    await this.audit.log({ userId: t.userId, action: 'set_password', data: { purpose: t.purpose }, ip });
    return { email: t.user.email };
  }
}

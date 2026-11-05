import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CSRF_HEADER, CSRF_VALUE, SESSION_COOKIE, type Role } from '@gelado/shared';
import { IS_PUBLIC, ROLES, SKIP_CSRF } from '../../common/decorators';
import { AuthService, sessionCookieOptions } from './auth.service';

/**
 * Guard global: sesión (cookie httpOnly) + rol + CSRF.
 * - @Public(): sin sesión.  - @Roles('ADMIN'): solo administradora.
 * - Peticiones que cambian datos en /api exigen X-Requested-With: XMLHttpRequest (docs/04).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, targets);

    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    // Toda petición que cambia datos exige la cabecera (sin mirar prefijo ni mayúsculas: Express enruta sin
    // distinguirlas). Solo el webhook firmado de Meta lleva @SkipCsrf.
    if (mutating && !skipCsrf) {
      if (req.get(CSRF_HEADER) !== CSRF_VALUE) throw new ForbiddenException({ statusCode: 403, message: 'Falta la cabecera de seguridad (CSRF)' });
    }

    if (isPublic) return true;
    const token = (req as any).cookies?.[SESSION_COOKIE] as string | undefined;
    const v = await this.auth.validateSessionEx(token);
    if (!v) throw new UnauthorizedException({ statusCode: 401, message: 'Sesión caducada. Vuelve a entrar.' });
    const user = v.user;
    req.user = user;
    // Caducidad deslizante también en el navegador: se reemite la cookie cuando la BD desliza la sesión
    if (v.slid && token) ctx.switchToHttp().getResponse().cookie(SESSION_COOKIE, token, sessionCookieOptions());

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException({ statusCode: 403, message: 'Solo la administradora puede hacer esto' });
    }
    return true;
  }
}

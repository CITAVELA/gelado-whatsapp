import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@gelado/shared';

export const IS_PUBLIC = 'isPublic';
/** Ruta sin sesión (login, webhook, /privacidad, /health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Restringe por rol. Sin @Roles = cualquier usuario autenticado. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
export const AdminOnly = () => Roles('ADMIN');

export const SKIP_CSRF = 'skipCsrf';
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  sessionId: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest();
  return req.user;
});

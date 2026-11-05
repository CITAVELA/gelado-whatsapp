import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loginSchema, setPasswordSchema, SESSION_COOKIE, type LoginDto, type SetPasswordDto } from '@gelado/shared';
import { AuthService, SESSION_TTL_MS } from './auth.service';
import { CurrentUser, Public, type AuthUser } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { config } from '../../common/config';

export function clientIp(req: Request): string | null {
  return (req.ip || req.socket?.remoteAddress || null) as string | null;
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.login(dto.email, dto.password, clientIp(req), req.get('user-agent') ?? null);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config().NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
    return user;
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.sessionId, user.id, clientIp(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return AuthService.toMe(user);
  }

  @Public()
  @Get('token/:token')
  tokenInfo(@Param('token') token: string) {
    return this.auth.tokenInfo(token);
  }

  @Public()
  @Post('set-password')
  @HttpCode(200)
  setPassword(@Body(new ZodPipe(setPasswordSchema)) dto: SetPasswordDto, @Req() req: Request) {
    return this.auth.setPassword(dto.token, dto.password, clientIp(req));
  }
}

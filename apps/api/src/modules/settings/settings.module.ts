import { Body, Controller, Get, Global, Module, Param, Put, Req, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { SETTING_KEYS, type SettingKey } from '@gelado/shared';
import { SettingsService } from './settings.service';
import { AdminOnly, CurrentUser, type AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { clientIp } from '../auth/auth.controller';

/** S7 completa: horario, fuera de horario, vacaciones, tarifas, /privacidad (SSR) y su editor. */
@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService, private readonly audit: AuditService) {}

  @Get()
  all() {
    return this.settings.all();
  }

  @Put(':key')
  @AdminOnly()
  async put(@Param('key') key: string, @Body() body: unknown, @CurrentUser() me: AuthUser, @Req() req: Request) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) throw new BadRequestException({ statusCode: 400, message: 'Ajuste desconocido' });
    const k = key as SettingKey;
    const input = k === 'privacy_policy' ? { ...(body as object), updatedAt: new Date().toISOString() } : body;
    try {
      const v = await this.settings.set(k, input, me.id);
      await this.audit.log({ userId: me.id, action: 'update_setting', entityType: 'Setting', entityId: k, ip: clientIp(req) });
      return v;
    } catch (e: any) {
      const issue = e?.issues?.[0];
      throw new BadRequestException({ statusCode: 400, message: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Ajuste no válido', details: e?.issues });
    }
  }
}

@Global()
@Module({ providers: [SettingsService], controllers: [SettingsController], exports: [SettingsService] })
export class SettingsModule {}

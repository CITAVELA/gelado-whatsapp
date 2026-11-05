import { Body, Controller, Get, Global, Module, Param, Put, Req, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { config } from '../../common/config';
import { normalizeRating } from './rating';
import { WhatsAppGateway } from '../whatsapp/whatsapp.gateway';
import { PrivacyService } from './privacy.service';
import { PrivacyAdminController, PrivacyPublicController } from './privacy.controller';
import type { WhatsAppSettingsDto, WaPhoneNumberInfo } from '@gelado/shared';
import type { Request } from 'express';
import { SETTING_KEYS, type SettingKey } from '@gelado/shared';
import { SettingsService } from './settings.service';
import { AdminOnly, CurrentUser, type AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { clientIp } from '../auth/auth.controller';

/** S7 completa: horario, fuera de horario, vacaciones, tarifas, /privacidad (SSR) y su editor. */
@Controller('api/settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly gateway: WhatsAppGateway,
  ) {}

  @Get()
  all() {
    return this.settings.all();
  }

  /** Datos del número, la cuenta y el webhook (solo lectura, sin secretos). */
  @Get('whatsapp')
  @AdminOnly()
  async whatsapp(): Promise<WhatsAppSettingsDto> {
    const c = config();
    let info: WaPhoneNumberInfo | null = null;
    try {
      info = await this.gateway.getPhoneNumber();
    } catch {
      const snap = await this.prisma.qualitySnapshot.findFirst({ orderBy: { createdAt: 'desc' } });
      info = (snap?.raw as WaPhoneNumberInfo | null) ?? null;
    }
    const [last, pending, failed] = await Promise.all([
      this.prisma.webhookEvent.findFirst({ where: { signatureValid: true }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
      this.prisma.webhookEvent.count({ where: { signatureValid: true, processedAt: null } }),
      this.prisma.webhookEvent.count({ where: { signatureValid: true, processedAt: null, error: { not: null } } }),
    ]);
    return {
      displayPhoneNumber: info?.display_phone_number ?? '+34 617 49 82 22',
      verifiedName: info?.verified_name ?? null,
      qualityRating: normalizeRating(info?.quality_rating),
      phoneStatus: info?.status ?? null,
      messagingLimit: info?.messaging_limit_tier ?? null,
      nameStatus: info?.name_status ?? null,
      wabaId: c.WA_WABA_ID,
      phoneNumberId: c.WA_PHONE_NUMBER_ID,
      businessId: c.META_BUSINESS_ID,
      graphApiVersion: c.GRAPH_API_VERSION,
      lastWebhookAt: last?.receivedAt.toISOString() ?? null,
      pendingWebhookEvents: pending,
      failedWebhookEvents: failed,
      webhookUrl: `${c.APP_URL.replace(/\/$/, '')}/webhooks/whatsapp`,
    };
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
@Module({ providers: [SettingsService, PrivacyService], controllers: [SettingsController, PrivacyAdminController, PrivacyPublicController], exports: [SettingsService, PrivacyService] })
export class SettingsModule {}

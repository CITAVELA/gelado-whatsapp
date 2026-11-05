import { BadRequestException, Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { privacyPlaceholders } from '@gelado/shared';
import { AdminOnly, Public } from '../../common/decorators';
import { PrivacyService } from './privacy.service';
import { SettingsService } from './settings.service';

/** Página pública /privacidad (RF-7.6): HTML completo desde el servidor, sin sesión y sin JavaScript. */
@Controller('privacidad')
export class PrivacyPublicController {
  constructor(private readonly privacy: PrivacyService) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=60')
  page() {
    return this.privacy.publicPage();
  }
}

@Controller('api/settings/privacy')
export class PrivacyAdminController {
  constructor(private readonly privacy: PrivacyService, private readonly settings: SettingsService) {}

  /** Texto actual del editor (GET /api/settings no lo incluye). */
  @Get()
  @AdminOnly()
  current() {
    return this.settings.get('privacy_policy');
  }

  /** Vista previa del editor: HTML saneado + campos entre corchetes pendientes. */
  @Post('preview')
  @HttpCode(200)
  @AdminOnly()
  preview(@Body() body: unknown) {
    const r = z.object({ markdown: z.string().max(200_000) }).safeParse(body);
    if (!r.success) throw new BadRequestException({ statusCode: 400, message: 'Texto no válido' });
    return { html: this.privacy.renderMarkdown(r.data.markdown), placeholders: privacyPlaceholders(r.data.markdown) };
  }
}

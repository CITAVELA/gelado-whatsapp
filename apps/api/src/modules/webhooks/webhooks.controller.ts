import { stripNul } from '../../common/json';
import { Controller, Get, HttpCode, Post, Query, Req, Res, ForbiddenException, BadRequestException, UnauthorizedException, type RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { config } from '../../common/config';
import { Public, SkipCsrf } from '../../common/decorators';
import { hmacSha256Hex, safeEqual } from '../../common/tokens';
import { WebhookIngestService } from './webhook-ingest.service';

/** Verifica `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(cuerpo crudo, META_APP_SECRET) en tiempo constante. */
export function verifySignature(rawBody: Buffer | undefined, header: string | undefined, secret = config().META_APP_SECRET): boolean {
  if (!rawBody || !header || !header.startsWith('sha256=')) return false;
  return safeEqual(header, `sha256=${hmacSha256Hex(secret, rawBody)}`);
}

@Controller('webhooks/whatsapp')
export class WebhooksController {
  constructor(private readonly ingest: WebhookIngestService) {}

  /** Verificación de Meta al configurar el webhook. */
  @Public()
  @Get()
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    if (mode === 'subscribe' && typeof token === 'string' && safeEqual(token, config().WA_VERIFY_TOKEN)) {
      res.status(200).type('text/plain').send(String(challenge ?? ''));
      return;
    }
    throw new ForbiddenException({ statusCode: 403, message: 'Token de verificación no válido' });
  }

  /** Recepción: firma → guardar → encolar → 200 rápido. */
  @Public()
  @SkipCsrf()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody;
    if (!verifySignature(raw, req.get('x-hub-signature-256'))) {
      await this.ingest.recordRejected(req.ip ?? null, !!req.get('x-hub-signature-256'));
      throw new UnauthorizedException({ statusCode: 401, message: 'Firma no válida' });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw!.toString('utf8'), stripNul); // sin NUL: PostgreSQL no lo admite (F-4)
    } catch {
      throw new BadRequestException({ statusCode: 400, message: 'Cuerpo no válido' });
    }
    const r = await this.ingest.ingest(payload);
    return { ok: true, ...r };
  }
}

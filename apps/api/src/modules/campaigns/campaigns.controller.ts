import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { audienceCountSchema, campaignUpsertSchema, launchSchema, recipientsQuerySchema, testSendSchema } from '@gelado/shared';
import type { AudienceCountRequest, CampaignUpsertDto } from '@gelado/shared';
import { AdminOnly, CurrentUser, type AuthUser } from '../../common/decorators';
import { attachmentDisposition } from '../../common/content-disposition';
import { ZodPipe } from '../../common/zod.pipe';
import { clientIp } from '../auth/auth.controller';
import { CampaignsService } from './campaigns.service';
import { z } from 'zod';

@Controller('api/campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list() {
    return this.campaigns.list();
  }

  @Post()
  create(@Body(new ZodPipe(campaignUpsertSchema)) dto: CampaignUpsertDto, @CurrentUser() me: AuthUser) {
    return this.campaigns.create(dto, me.id);
  }

  @Post('audience-count')
  audienceCount(@Body(new ZodPipe(audienceCountSchema)) dto: AudienceCountRequest) {
    return this.campaigns.countAudience(dto);
  }

  @Get('analytics')
  analytics() {
    return this.campaigns.analytics();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(campaignUpsertSchema)) dto: CampaignUpsertDto) {
    return this.campaigns.update(id, dto);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser, @Req() req: Request) {
    return this.campaigns.remove(id, me.id, clientIp(req));
  }

  @Get(':id/recipients')
  recipients(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(recipientsQuerySchema)) q: z.infer<typeof recipientsQuerySchema>) {
    return this.campaigns.recipients(id, q);
  }

  @Get(':id/export')
  @AdminOnly()
  async export(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser, @Req() req: Request, @Res() res: Response) {
    const { name, csv } = await this.campaigns.exportCsv(id, me.id, clientIp(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', attachmentDisposition(name));
    res.send(csv);
  }

  @Post(':id/test')
  @AdminOnly()
  test(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(testSendSchema)) dto: { phone: string }, @CurrentUser() me: AuthUser, @Req() req: Request) {
    return this.campaigns.test(id, dto.phone, me.id, clientIp(req));
  }

  @Post(':id/launch')
  @AdminOnly()
  launch(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(launchSchema)) dto: z.infer<typeof launchSchema>, @CurrentUser() me: AuthUser, @Req() req: Request) {
    return this.campaigns.launch(id, me.id, dto.scheduledAt, clientIp(req));
  }

  @Post(':id/pause')
  @AdminOnly()
  pause(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser, @Req() req: Request) {
    return this.campaigns.pause(id, me.id, clientIp(req));
  }

  @Post(':id/resume')
  @AdminOnly()
  resume(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser, @Req() req: Request) {
    return this.campaigns.resume(id, me.id, clientIp(req));
  }

  @Post(':id/cancel')
  @AdminOnly()
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser, @Req() req: Request) {
    return this.campaigns.cancel(id, me.id, clientIp(req));
  }

  @Post(':id/duplicate')
  duplicate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.campaigns.duplicate(id, me.id);
  }
}

import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  bulkContactsSchema, consentChangeSchema, contactListQuerySchema, contactUpsertSchema,
  type BulkContactsDto, type ConsentChangeDto, type ContactListQuery, type ContactUpsertDto,
} from '@gelado/shared';
import { AdminOnly, CurrentUser, type AuthUser } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { clientIp } from '../auth/auth.controller';
import { ContactsService } from './contacts.service';

const ctx = (me: AuthUser, req: Request) => ({ userId: me.id, ip: clientIp(req) });

/** Las rutas fijas (export, bulk) van antes que :id. La importación vive en ImportController. */
@Controller('api/contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(@Query(new ZodPipe(contactListQuerySchema)) q: ContactListQuery) {
    return this.contacts.list(q);
  }

  @Post()
  create(@Body(new ZodPipe(contactUpsertSchema)) dto: ContactUpsertDto, @CurrentUser() me: AuthUser, @Req() req: Request) {
    return this.contacts.create(dto, ctx(me, req));
  }

  @Get('export')
  @AdminOnly()
  async export(@Query(new ZodPipe(contactListQuerySchema)) q: ContactListQuery, @CurrentUser() me: AuthUser, @Req() req: Request, @Res() res: Response) {
    const { csv } = await this.contacts.exportCsv(q, ctx(me, req));
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contactos-${day}.csv"`);
    res.send(csv);
  }

  @Post('bulk')
  bulk(@Body(new ZodPipe(bulkContactsSchema)) dto: BulkContactsDto, @CurrentUser() me: AuthUser, @Req() req: Request) {
    return this.contacts.bulk(dto, ctx(me, req));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(contactUpsertSchema.partial())) dto: Partial<ContactUpsertDto>, @CurrentUser() me: AuthUser, @Req() req: Request) {
    return this.contacts.update(id, dto, ctx(me, req));
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id', ParseUUIDPipe) id: string, @Query('hard') hard: string | undefined, @CurrentUser() me: AuthUser, @Req() req: Request) {
    return this.contacts.remove(id, hard === 'true' || hard === '1', ctx(me, req));
  }

  @Get(':id/consent')
  consentHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.consentHistory(id);
  }

  @Post(':id/consent')
  changeConsent(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(consentChangeSchema)) dto: ConsentChangeDto, @CurrentUser() me: AuthUser, @Req() req: Request) {
    return this.contacts.changeConsent(id, dto, ctx(me, req));
  }

  @Get(':id/campaigns')
  campaigns(@Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.campaigns(id);
  }
}

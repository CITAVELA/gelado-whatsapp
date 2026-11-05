import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { templateEditorSchema, type TemplateEditorDto } from '@gelado/shared';
import { AdminOnly, CurrentUser, type AuthUser } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { TemplatesService } from './templates.service';

@Controller('api/templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list(@Query() q: { status?: string; category?: string; q?: string; language?: string }) {
    return this.templates.list(q);
  }

  @Post('sync')
  @AdminOnly()
  sync(@CurrentUser() me: AuthUser) {
    return this.templates.sync(me.id);
  }

  @Post()
  @AdminOnly()
  create(@Body(new ZodPipe(templateEditorSchema)) dto: TemplateEditorDto, @CurrentUser() me: AuthUser) {
    return this.templates.create(dto, me.id);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(id);
  }

  @Post(':id/duplicate')
  @AdminOnly()
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.duplicate(id);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.templates.remove(id, me.id);
  }
}

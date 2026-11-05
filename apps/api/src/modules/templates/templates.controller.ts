import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { templateDraftSchema, templateEditorSchema, type TemplateDraftDto, type TemplateEditorDto } from '@gelado/shared';
import { AdminOnly, CurrentUser, type AuthUser } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { TemplatesService } from './templates.service';

@Controller('api/templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  /** Los borradores locales (`LOCAL_DRAFT`) solo salen para la administradora. */
  @Get()
  list(@Query() q: { status?: string; category?: string; q?: string; language?: string }, @CurrentUser() me: AuthUser) {
    return this.templates.list(q, me.role === 'ADMIN');
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

  /** «Guardar borrador»: guarda en la BD sin llamar a Meta (validación suave). */
  @Post('draft')
  @AdminOnly()
  createDraft(@Body(new ZodPipe(templateDraftSchema)) dto: TemplateDraftDto, @CurrentUser() me: AuthUser) {
    return this.templates.createDraft(dto, me.id);
  }

  @Put(':id/draft')
  @AdminOnly()
  updateDraft(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(templateDraftSchema)) dto: TemplateDraftDto, @CurrentUser() me: AuthUser) {
    return this.templates.updateDraft(id, dto, me.id);
  }

  /** Envía a revisión un borrador: misma validación y mismo envío que `POST /api/templates`. */
  @Post(':id/submit')
  @AdminOnly()
  submitDraft(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(templateEditorSchema)) dto: TemplateEditorDto, @CurrentUser() me: AuthUser) {
    return this.templates.submitDraft(id, dto, me.id);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.templates.get(id, me.role === 'ADMIN');
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

import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { labelUpsertSchema, type LabelUpsertDto, type LabelScope } from '@gelado/shared';
import { AdminOnly, CurrentUser, type AuthUser } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { LabelsService } from './labels.service';

@Controller('api/labels')
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get()
  list(@Query('scope') scope?: string) {
    return this.labels.list(scope === 'CONTACT' || scope === 'CONVERSATION' ? (scope as LabelScope) : undefined);
  }

  @Post()
  create(@Body(new ZodPipe(labelUpsertSchema)) dto: LabelUpsertDto, @CurrentUser() me: AuthUser) {
    return this.labels.create(dto, me.id);
  }

  @Patch(':id')
  @AdminOnly()
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(labelUpsertSchema.partial())) dto: Partial<LabelUpsertDto>, @CurrentUser() me: AuthUser) {
    return this.labels.update(id, dto, me.id);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.labels.remove(id, me.id);
  }
}

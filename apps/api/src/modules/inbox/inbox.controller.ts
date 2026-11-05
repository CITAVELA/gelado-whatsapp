import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  assignSchema, conversationLabelsSchema, conversationListQuerySchema, newConversationSchema, sendMessageSchema, snoozeSchema, starSchema,
  type ConversationListQuery, type SendMessageDto, type SnoozeDto,
} from '@gelado/shared';
import { CurrentUser, type AuthUser } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { CountsService } from './counts.service';
import { InboxActionsService } from './inbox-actions.service';
import { InboxService } from './inbox.service';

const uuid = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException({ statusCode: 400, message: 'Identificador no válido' }) });

@Controller('api/conversations')
export class InboxController {
  constructor(private readonly inbox: InboxService, private readonly actions: InboxActionsService, private readonly counts: CountsService) {}

  @Get()
  list(@Query(new ZodPipe(conversationListQuerySchema)) q: ConversationListQuery, @CurrentUser() me: AuthUser) {
    return this.inbox.list(q, me.id);
  }

  @Get('counts')
  countsOf(@CurrentUser() me: AuthUser) {
    return this.counts.countsFor(me.id);
  }

  @Post()
  create(@Body(new ZodPipe(newConversationSchema)) dto: { phone: string; firstName?: string }) {
    return this.inbox.create(dto);
  }

  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.inbox.detail(id);
  }

  @Get(':id/timeline')
  timeline(@Param('id', uuid) id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.inbox.timeline(id, { cursor, limit: limit ? Number(limit) : undefined });
  }

  @Post(':id/messages')
  send(@Param('id', uuid) id: string, @Body(new ZodPipe(sendMessageSchema)) dto: SendMessageDto, @CurrentUser() me: AuthUser) {
    return this.actions.send(id, dto, me.id);
  }

  @Post(':id/messages/:messageId/retry')
  retry(@Param('id', uuid) id: string, @Param('messageId', uuid) messageId: string, @CurrentUser() me: AuthUser) {
    return this.actions.retry(id, messageId, me.id);
  }

  @Post(':id/read')
  async read(@Param('id', uuid) id: string) {
    await this.actions.markRead(id);
    return { ok: true };
  }

  @Post(':id/unread')
  async unread(@Param('id', uuid) id: string) {
    await this.actions.markUnread(id);
    return { ok: true };
  }

  @Post(':id/assign')
  async assign(@Param('id', uuid) id: string, @Body(new ZodPipe(assignSchema)) dto: { assigneeId: string | null }, @CurrentUser() me: AuthUser) {
    await this.actions.assign(id, dto.assigneeId, me.id);
    return { ok: true };
  }

  @Post(':id/snooze')
  async snooze(@Param('id', uuid) id: string, @Body(new ZodPipe(snoozeSchema)) dto: SnoozeDto, @CurrentUser() me: AuthUser) {
    await this.actions.snooze(id, dto, me.id);
    return { ok: true };
  }

  @Post(':id/done')
  async done(@Param('id', uuid) id: string, @CurrentUser() me: AuthUser) {
    await this.actions.done(id, me.id);
    return { ok: true };
  }

  @Post(':id/reopen')
  async reopen(@Param('id', uuid) id: string, @CurrentUser() me: AuthUser) {
    await this.actions.reopen(id, me.id);
    return { ok: true };
  }

  @Post(':id/star')
  async star(@Param('id', uuid) id: string, @Body(new ZodPipe(starSchema)) dto: { starred: boolean }, @CurrentUser() me: AuthUser) {
    await this.actions.star(id, dto.starred, me.id);
    return { ok: true };
  }

  @Post(':id/labels')
  async labels(@Param('id', uuid) id: string, @Body(new ZodPipe(conversationLabelsSchema)) dto: { add: string[]; remove: string[] }, @CurrentUser() me: AuthUser) {
    await this.actions.setLabels(id, dto, me.id);
    return { ok: true };
  }
}

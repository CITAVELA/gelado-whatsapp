import { Module } from '@nestjs/common';
import { CountsService } from './counts.service';
import { InboxActionsService } from './inbox-actions.service';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

/** S5 · Bandeja: conversaciones, vistas, contadores, asignación, posponer, finalizar, notas, búsqueda, tiempo real. */
@Module({
  controllers: [InboxController],
  providers: [InboxService, InboxActionsService, CountsService],
  exports: [InboxService, InboxActionsService, CountsService],
})
export class InboxModule {}

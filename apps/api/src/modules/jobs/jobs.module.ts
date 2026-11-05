import { Global, Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service';
import { JobsService } from './jobs.service';

/** pg-boss (colas y crons) y la limpieza diaria. */
@Global()
@Module({ providers: [JobsService, CleanupService], exports: [JobsService] })
export class JobsModule {}

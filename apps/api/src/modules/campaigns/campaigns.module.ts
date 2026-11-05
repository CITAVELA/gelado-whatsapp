import { Module } from '@nestjs/common';
import { QualityModule } from '../quality/quality.module';
import { AudienceService } from './audience.service';
import { CampaignProgressService } from './campaign-progress.service';
import { CampaignRunnerService } from './campaign-runner.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignClock } from './campaigns.clock';
import { CampaignsService } from './campaigns.service';

/** S6 · Campañas: asistente, audiencia, prueba, programación, envío escalonado, paradas automáticas e informe. */
@Module({
  imports: [QualityModule],
  controllers: [CampaignsController],
  providers: [CampaignClock, AudienceService, CampaignProgressService, CampaignRunnerService, CampaignsService],
  exports: [CampaignClock, CampaignsService],
})
export class CampaignsModule {}

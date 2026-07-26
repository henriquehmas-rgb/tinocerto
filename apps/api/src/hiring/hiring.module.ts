import { Module } from '@nestjs/common';
import { RequisitionController } from './requisition.controller';
import { RequisitionService } from './requisition.service';
import { JobController } from './job.controller';
import { JobService } from './job.service';
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';
import { CandidateTouchpointService } from './candidate-touchpoint.service';
import { OutboxService } from '../outbox/outbox.service';

@Module({
  controllers: [RequisitionController, JobController, ApplicationController],
  providers: [RequisitionService, JobService, ApplicationService, CandidateTouchpointService, OutboxService],
})
export class HiringModule {}

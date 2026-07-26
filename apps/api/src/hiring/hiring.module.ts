import { Module } from '@nestjs/common';
import { RequisitionController } from './requisition.controller';
import { RequisitionService } from './requisition.service';
import { JobController } from './job.controller';
import { JobService } from './job.service';
import { JobCustomFieldService } from './job-custom-field.service';
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';
import { PipelineStageTransitionService } from './pipeline-stage-transition.service';
import { CandidateTouchpointService } from './candidate-touchpoint.service';
import { DecisionService } from './decision.service';
import { ApplicationCustomFieldResponseService } from './application-custom-field-response.service';
import { QuotaService } from './quota.service';
import { LiaDocumentService } from './lia-document.service';
import { OutboxService } from '../outbox/outbox.service';

@Module({
  controllers: [RequisitionController, JobController, ApplicationController],
  providers: [
    RequisitionService,
    JobService,
    JobCustomFieldService,
    ApplicationService,
    PipelineStageTransitionService,
    CandidateTouchpointService,
    DecisionService,
    ApplicationCustomFieldResponseService,
    QuotaService,
    LiaDocumentService,
    OutboxService,
  ],
})
export class HiringModule {}

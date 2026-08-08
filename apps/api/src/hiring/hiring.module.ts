import { Module } from '@nestjs/common';
import { RequisitionController } from './requisition.controller';
import { RequisitionService } from './requisition.service';
import { JobController } from './job.controller';
import { JobService } from './job.service';
import { JobRecrutadorService } from './job-recrutador.service';
import { JobCustomFieldService } from './job-custom-field.service';
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';
import { PipelineStageTransitionService } from './pipeline-stage-transition.service';
import { CandidateTouchpointService } from './candidate-touchpoint.service';
import { DecisionService } from './decision.service';
import { DecisionController } from './decision.controller';
import { OfferService } from './offer.service';
import { OfferController } from './offer.controller';
import { ApplicationStartedWorkService } from './application-started-work.service';
import { ApplicationCustomFieldResponseService } from './application-custom-field-response.service';
import { QuotaService } from './quota.service';
import { LiaDocumentService } from './lia-document.service';
import { CandidateEvaluationViewService } from './candidate-evaluation-view.service';
import { OutboxService } from '../outbox/outbox.service';

@Module({
  controllers: [RequisitionController, JobController, ApplicationController, OfferController, DecisionController],
  providers: [
    RequisitionService,
    JobService,
    JobRecrutadorService,
    JobCustomFieldService,
    ApplicationService,
    PipelineStageTransitionService,
    CandidateTouchpointService,
    DecisionService,
    OfferService,
    ApplicationStartedWorkService,
    ApplicationCustomFieldResponseService,
    QuotaService,
    LiaDocumentService,
    CandidateEvaluationViewService,
    OutboxService,
  ],
  exports: [ApplicationService, DecisionService, CandidateEvaluationViewService],
})
export class HiringModule {}

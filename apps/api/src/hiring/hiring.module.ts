import { Module } from '@nestjs/common';
import { RequisitionController } from './requisition.controller';
import { RequisitionService } from './requisition.service';
import { JobController } from './job.controller';
import { JobService } from './job.service';

@Module({
  controllers: [RequisitionController, JobController],
  providers: [RequisitionService, JobService],
})
export class HiringModule {}

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CompetencyService } from './competency.service';
import { InterviewGuideService } from './interview-guide.service';
import { InterviewScheduleService } from './interview-schedule.service';
import { ScorecardService } from './scorecard.service';
import { InterviewGuideController } from './interview-guide.controller';
import { InterviewScheduleController } from './interview-schedule.controller';
import { ScorecardController } from './scorecard.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [InterviewGuideController, InterviewScheduleController, ScorecardController],
  providers: [CompetencyService, InterviewGuideService, InterviewScheduleService, ScorecardService],
})
export class InterviewModule {}

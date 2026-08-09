import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { HiringModule } from '../hiring/hiring.module';
import { JobRecrutadorService } from '../hiring/job-recrutador.service';
import { ApplicationService } from '../hiring/application.service';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';
import { AuditLogService } from '../trust/audit-log.service';
import { DatabaseService } from '../database/database.service';
import { CompetencyService } from './competency.service';
import { InterviewGuideService } from './interview-guide.service';
import { InterviewScheduleService } from './interview-schedule.service';
import { ScorecardService } from './scorecard.service';
import { BarsGenerationService } from './bars-generation.service';
import { InterviewGuideController } from './interview-guide.controller';
import { InterviewScheduleController } from './interview-schedule.controller';
import { ScorecardController } from './scorecard.controller';
import { GoogleOAuthService } from './scheduling/google-oauth.service';
import { GoogleCalendarApiClient } from './scheduling/google-calendar-client';
import { CalendarEventService } from './scheduling/calendar-event.service';
import { InterviewSchedulingService } from './scheduling/interview-scheduling.service';
import { GoogleCalendarConnectionController } from './scheduling/google-calendar-connection.controller';

@Module({
  imports: [DatabaseModule, HiringModule],
  controllers: [
    InterviewGuideController,
    InterviewScheduleController,
    ScorecardController,
    GoogleCalendarConnectionController,
  ],
  providers: [
    // JobRecrutadorService (onda 3 de correcao pos-revisao, Item 3): mesma
    // convencao ja usada em copilot.module.ts/matching.module.ts/insights.module.ts
    // -- HiringModule NAO exporta JobRecrutadorService, entao cada modulo que
    // precisa checar posse por recrutador registra sua propria instancia local
    // (sem dependencias, seguro de instanciar por modulo).
    JobRecrutadorService,
    CompetencyService,
    InterviewGuideService,
    InterviewScheduleService,
    ScorecardService,
    BarsGenerationService,
    EnvelopeEncryptionService,
    AuditLogService,
    GoogleOAuthService,
    {
      provide: CalendarEventService,
      useFactory: (
        oauthService: GoogleOAuthService,
        applicationService: ApplicationService,
        auditLog: AuditLogService,
        databaseService: DatabaseService,
      ) =>
        new CalendarEventService(oauthService, applicationService, auditLog, new GoogleCalendarApiClient(), databaseService),
      inject: [GoogleOAuthService, ApplicationService, AuditLogService, DatabaseService],
    },
    InterviewSchedulingService,
  ],
})
export class InterviewModule {}

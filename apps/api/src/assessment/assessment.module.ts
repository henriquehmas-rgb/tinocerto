import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';
import { ReportService } from './report/report.service';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';
import { OutboxService } from '../outbox/outbox.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AssessmentController],
  providers: [AssessmentService, ReportService, EnvelopeEncryptionService, OutboxService],
  // ReportService exportado para HiringModule (ApplicationController,
  // Fase 5a Task 4) consumir GET :id/assessment-report -- combina o
  // relatório por dimensão (Fase 2a) com o score de aderência de skills
  // (Fase 2b, MatchingModule) numa única rota do painel do recrutador.
  exports: [ReportService],
})
export class AssessmentModule {}

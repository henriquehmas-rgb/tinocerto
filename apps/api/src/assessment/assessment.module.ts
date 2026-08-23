import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';
import { InstrumentVersionController } from './instrument-version.controller';
import { ReportService } from './report/report.service';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';
import { OutboxService } from '../outbox/outbox.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AssessmentController, InstrumentVersionController],
  providers: [
    AssessmentService,
    ReportService,
    EnvelopeEncryptionService,
    OutboxService,
    { provide: Pool, useFactory: (db: DatabaseService) => db.pool, inject: [DatabaseService] },
  ],
  // ReportService exportado para HiringModule (ApplicationController,
  // Fase 5a Task 4) consumir GET :id/assessment-report -- combina o
  // relatório por dimensão (Fase 2a) com o score de aderência de skills
  // (Fase 2b, MatchingModule) numa única rota do painel do recrutador.
  // AssessmentService exportado para PublicModule (Task 3, disparo
  // automático ao candidatar-se) e CandidateAuthModule (Task 4, respostas
  // candidate-scoped) consumirem sem duplicar a lógica de convidar/iniciar/
  // responderBloco/concluir.
  exports: [ReportService, AssessmentService],
})
export class AssessmentModule {}

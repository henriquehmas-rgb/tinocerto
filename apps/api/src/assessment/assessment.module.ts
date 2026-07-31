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
})
export class AssessmentModule {}

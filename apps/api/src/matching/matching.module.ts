import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PersonService } from '../talent/person.service';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';
import { AdherenceController } from './adherence.controller';
import { AdherenceService } from './adherence.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AdherenceController],
  providers: [AdherenceService, PersonService, EnvelopeEncryptionService],
  // AdherenceService exportado para HiringModule (ApplicationController,
  // Fase 5a Task 4) consumir GET :id/assessment-report -- ver comentário
  // equivalente em assessment.module.ts.
  exports: [AdherenceService],
})
export class MatchingModule {}

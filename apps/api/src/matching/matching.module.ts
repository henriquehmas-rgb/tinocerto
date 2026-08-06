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
})
export class MatchingModule {}

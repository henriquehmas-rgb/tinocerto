import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PersonService } from '../talent/person.service';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';
import { ApplicationService } from '../hiring/application.service';
import { JobRecrutadorService } from '../hiring/job-recrutador.service';
import { OutboxService } from '../outbox/outbox.service';
import { AdherenceController } from './adherence.controller';
import { AdherenceService } from './adherence.service';

// ApplicationService/JobRecrutadorService/OutboxService registrados aqui
// (não importando HiringModule) para evitar dependência circular:
// HiringModule já importa MatchingModule (para AdherenceService em
// ApplicationController, Fase 5a Task 4) -- MatchingModule importar
// HiringModule de volta criaria um ciclo. Os dois serviços não têm
// dependências específicas de outro módulo (ApplicationService só
// depende de OutboxService; JobRecrutadorService não tem dependências),
// então registrá-los como providers locais é seguro -- mesma instância
// lógica (mesmas queries, mesmo schema), só não compartilhada com a do
// HiringModule (não há estado interno para divergir).
@Module({
  imports: [DatabaseModule],
  controllers: [AdherenceController],
  providers: [AdherenceService, PersonService, EnvelopeEncryptionService, ApplicationService, JobRecrutadorService, OutboxService],
  // AdherenceService exportado para HiringModule (ApplicationController,
  // Fase 5a Task 4) consumir GET :id/assessment-report -- ver comentário
  // equivalente em assessment.module.ts.
  exports: [AdherenceService],
})
export class MatchingModule {}

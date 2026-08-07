// apps/api/src/copilot/copilot.module.ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditLogService } from '../trust/audit-log.service';
import { PersonService } from '../talent/person.service';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';
import { JobDescriptionCopilotService } from './job-description-copilot.service';
import { JobDescriptionCopilotController } from './job-description-copilot.controller';
import { CandidateSummaryService } from './candidate-summary.service';
import { CandidateSummaryController } from './candidate-summary.controller';
import { InterviewQuestionSuggestionService } from './interview-question-suggestion.service';
import { InterviewQuestionSuggestionController } from './interview-question-suggestion.controller';

// AuditLogService não é @Global() (nenhum TrustModule o registra -- outros
// consumidores, ex. LlmRouterModule, o instanciam manualmente com `new`).
// Registrado aqui como provider comum para que a injeção de dependência de
// JobDescriptionCopilotService/CandidateSummaryService funcione via Nest.
//
// [Desvio do plano original] PersonService/EnvelopeEncryptionService
// registrados aqui porque CandidateSummaryService passou a depender de
// PersonService.perfilCitavel (ver comentário em
// candidate-summary.service.ts) -- mesmo padrão de MatchingModule, que
// registra os dois para AdherenceService (Fase 2b).
@Module({
  imports: [DatabaseModule],
  controllers: [JobDescriptionCopilotController, CandidateSummaryController, InterviewQuestionSuggestionController],
  providers: [
    AuditLogService,
    PersonService,
    EnvelopeEncryptionService,
    JobDescriptionCopilotService,
    CandidateSummaryService,
    InterviewQuestionSuggestionService,
  ],
})
export class CopilotModule {}

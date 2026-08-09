import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { JobRecrutadorService } from '../hiring/job-recrutador.service';
import { AdverseImpactController } from './adverse-impact.controller';
import { AdverseImpactSnapshotService } from './adverse-impact-snapshot.service';
import { AdverseImpactConsumer } from './adverse-impact.consumer';

// AdverseImpactConsumer recebe DatabaseService pelo próprio construtor
// (mesmo padrão de todo controller do projeto) -- Nest DI resolve
// sozinho, DatabaseModule é @Global(). Nenhum provider extra de
// Pool/TenantContext é necessário aqui.
//
// JobRecrutadorService (Fase 5a, fix C3): AdverseImpactController agora
// exige posse por recrutador antes de ler o snapshot de uma vaga --
// registrado aqui como provider local (não importando HiringModule) pelo
// mesmo motivo documentado em MatchingModule/CopilotModule: evitar
// dependência circular; o serviço não tem dependências de outro módulo.
@Module({
  imports: [DatabaseModule],
  controllers: [AdverseImpactController],
  providers: [AdverseImpactSnapshotService, AdverseImpactConsumer, JobRecrutadorService],
})
export class InsightsModule {}

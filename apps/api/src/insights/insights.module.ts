import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AdverseImpactController } from './adverse-impact.controller';
import { AdverseImpactSnapshotService } from './adverse-impact-snapshot.service';
import { AdverseImpactConsumer } from './adverse-impact.consumer';

// AdverseImpactConsumer recebe DatabaseService pelo próprio construtor
// (mesmo padrão de todo controller do projeto) -- Nest DI resolve
// sozinho, DatabaseModule é @Global(). Nenhum provider extra de
// Pool/TenantContext é necessário aqui.
@Module({
  imports: [DatabaseModule],
  controllers: [AdverseImpactController],
  providers: [AdverseImpactSnapshotService, AdverseImpactConsumer],
})
export class InsightsModule {}

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { HiringModule } from '../hiring/hiring.module';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';
import { IdempotencyService } from './idempotency.service';
import { PlatformApplicationController } from './platform-application.controller';
import { DeveloperApiKeyController } from './developer-api-key.controller';
import { LaudoPsicologicoAccessGuard } from './laudo-psicologico-access.guard';
import { PlatformPsychReportController } from './platform-psych-report.controller';
import { PsychReportService } from './psych-report.service';
import { ServiceAccountCrpLinkService } from './service-account-crp-link.service';

@Module({
  imports: [DatabaseModule, HiringModule],
  controllers: [PlatformApplicationController, DeveloperApiKeyController, PlatformPsychReportController],
  providers: [
    { provide: ApiKeyService, useFactory: (db: DatabaseService) => new ApiKeyService(db.pool), inject: [DatabaseService] },
    ApiKeyGuard,
    IdempotencyService,
    ServiceAccountCrpLinkService,
    LaudoPsicologicoAccessGuard,
    PsychReportService,
  ],
  exports: [ApiKeyService, IdempotencyService],
})
export class PlatformApiModule {}

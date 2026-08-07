import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { HiringModule } from '../hiring/hiring.module';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';
import { IdempotencyService } from './idempotency.service';
import { PlatformApplicationController } from './platform-application.controller';
import { DeveloperApiKeyController } from './developer-api-key.controller';

@Module({
  imports: [DatabaseModule, HiringModule],
  controllers: [PlatformApplicationController, DeveloperApiKeyController],
  providers: [
    { provide: ApiKeyService, useFactory: (db: DatabaseService) => new ApiKeyService(db.pool), inject: [DatabaseService] },
    ApiKeyGuard,
    IdempotencyService,
  ],
  exports: [ApiKeyService, IdempotencyService],
})
export class PlatformApiModule {}

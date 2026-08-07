import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { HiringModule } from '../hiring/hiring.module';
import { OutboxPublishingScheduler } from '../outbox/outbox-publishing.scheduler';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';
import { IdempotencyService } from './idempotency.service';
import { PlatformApplicationController } from './platform-application.controller';

@Module({
  imports: [DatabaseModule, HiringModule],
  controllers: [PlatformApplicationController],
  providers: [
    { provide: ApiKeyService, useFactory: (db: DatabaseService) => new ApiKeyService(db.pool), inject: [DatabaseService] },
    ApiKeyGuard,
    IdempotencyService,
    OutboxPublishingScheduler,
  ],
  exports: [ApiKeyService, IdempotencyService],
})
export class PlatformApiModule {}

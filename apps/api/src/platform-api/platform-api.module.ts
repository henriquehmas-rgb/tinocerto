import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { HiringModule } from '../hiring/hiring.module';
import { OutboxPublishingScheduler } from '../outbox/outbox-publishing.scheduler';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';
import { IdempotencyService } from './idempotency.service';
import { PlatformApplicationController } from './platform-application.controller';
import { WebhookEndpointController } from './webhooks/webhook-endpoint.controller';
import { WebhookEndpointService } from './webhooks/webhook-endpoint.service';
import { WebhookDeliveryService } from './webhooks/webhook-delivery.service';
import { WebhookDeliveryConsumer } from './webhooks/webhook-delivery.consumer';
import { WebhookRetryScheduler } from './webhooks/webhook-retry.scheduler';
import { WebhookEndpointDisableScheduler } from './webhooks/webhook-endpoint-disable.scheduler';

@Module({
  imports: [DatabaseModule, HiringModule],
  controllers: [PlatformApplicationController, WebhookEndpointController],
  providers: [
    { provide: ApiKeyService, useFactory: (db: DatabaseService) => new ApiKeyService(db.pool), inject: [DatabaseService] },
    ApiKeyGuard,
    IdempotencyService,
    OutboxPublishingScheduler,
    WebhookEndpointService,
    WebhookDeliveryService,
    WebhookDeliveryConsumer,
    WebhookRetryScheduler,
    WebhookEndpointDisableScheduler,
  ],
  exports: [ApiKeyService, IdempotencyService],
})
export class PlatformApiModule {}

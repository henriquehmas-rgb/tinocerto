import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { HiringModule } from '../hiring/hiring.module';
import { OutboxPublishingScheduler } from '../outbox/outbox-publishing.scheduler';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';
import { IdempotencyService } from './idempotency.service';
import { RateLimitService } from './rate-limit.service';
import { RateLimitGuard } from './rate-limit.guard';
import { PlatformApplicationController } from './platform-application.controller';
import { WebhookEndpointController } from './webhooks/webhook-endpoint.controller';
import { WebhookEndpointService } from './webhooks/webhook-endpoint.service';
import { WebhookDeliveryService } from './webhooks/webhook-delivery.service';
import { WebhookDeliveryConsumer } from './webhooks/webhook-delivery.consumer';
import { WebhookRetryScheduler } from './webhooks/webhook-retry.scheduler';
import { WebhookEndpointDisableScheduler } from './webhooks/webhook-endpoint-disable.scheduler';
import { WebhookDeliveryController } from './webhooks/webhook-delivery.controller';
import { DeveloperApiKeyController } from './developer-api-key.controller';
import { LaudoPsicologicoAccessGuard } from './laudo-psicologico-access.guard';
import { PlatformPsychReportController } from './platform-psych-report.controller';
import { PsychReportService } from './psych-report.service';
import { ServiceAccountCrpLinkService } from './service-account-crp-link.service';
import { DeveloperDocsController } from './developer-docs.controller';

// Dois roots estáticos, ambos self-hospedados -- nenhum CDN, nenhum SaaS
// de terceiro que veria o schema (design spec, decisão 3).
//
// 1. openapi/ inteiro (não só openapi.yaml) -- os $ref relativos entre
//    openapi.yaml/components/paths (estrutura multi-arquivo da 4a) só
//    resolvem no navegador se os arquivos referenciados também estiverem
//    servidos nos MESMOS caminhos relativos.
// 2. O bundle standalone do @scalar/api-reference, vendorizado -- zero
//    chamada de rede em runtime para renderizar a página de docs.
@Module({
  imports: [
    DatabaseModule,
    HiringModule,
    ServeStaticModule.forRoot(
      {
        rootPath: join(__dirname, '..', '..', 'openapi'),
        serveRoot: '/v1/developer/openapi-spec',
      },
      {
        rootPath: join(__dirname, '..', '..', 'node_modules/@scalar/api-reference/dist/browser'),
        serveRoot: '/v1/developer/docs/assets',
      },
    ),
  ],
  controllers: [
    PlatformApplicationController,
    WebhookEndpointController,
    WebhookDeliveryController,
    DeveloperApiKeyController,
    PlatformPsychReportController,
    DeveloperDocsController,
  ],
  providers: [
    { provide: ApiKeyService, useFactory: (db: DatabaseService) => new ApiKeyService(db.pool), inject: [DatabaseService] },
    ApiKeyGuard,
    IdempotencyService,
    RateLimitService,
    RateLimitGuard,
    OutboxPublishingScheduler,
    WebhookEndpointService,
    WebhookDeliveryService,
    WebhookDeliveryConsumer,
    WebhookRetryScheduler,
    WebhookEndpointDisableScheduler,
    ServiceAccountCrpLinkService,
    LaudoPsicologicoAccessGuard,
    PsychReportService,
  ],
  exports: [ApiKeyService, IdempotencyService],
})
export class PlatformApiModule {}

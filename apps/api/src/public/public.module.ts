import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { PublicController } from './public.controller';
import { PublicJobService } from './public-job.service';
import { PublicApplicationController } from './public-application.controller';
import { PublicApplicationService } from './public-application.service';
import { PublicTenantResolutionMiddleware } from './public-tenant-resolution.middleware';
import { StorageService } from '../storage/storage.service';
import { CandidateTouchpointService } from '../hiring/candidate-touchpoint.service';
import { ApplicationService } from '../hiring/application.service';
import { ApplicationCustomFieldResponseService } from '../hiring/application-custom-field-response.service';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';
import { OutboxService } from '../outbox/outbox.service';
import { CandidateAuthGuard } from '../candidate-auth/candidate-auth.guard';
import { CandidateJwtService } from '../candidate-auth/candidate-jwt.service';
import { IpRateLimitService } from '../security/ip-rate-limit.service';
import { IpRateLimitGuard } from '../security/ip-rate-limit.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [PublicController, PublicApplicationController],
  providers: [
    PublicJobService,
    PublicApplicationService,
    PublicTenantResolutionMiddleware,
    StorageService,
    CandidateTouchpointService,
    ApplicationService,
    ApplicationCustomFieldResponseService,
    EnvelopeEncryptionService,
    OutboxService,
    CandidateAuthGuard,
    CandidateJwtService,
    IpRateLimitService,
    IpRateLimitGuard,
    { provide: Pool, useFactory: (db: DatabaseService) => db.pool, inject: [DatabaseService] },
  ],
})
export class PublicModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PublicTenantResolutionMiddleware).forRoutes(PublicController, PublicApplicationController);
  }
}

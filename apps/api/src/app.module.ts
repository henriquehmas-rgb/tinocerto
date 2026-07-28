import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { TenantResolutionMiddleware } from './database/tenant-transaction.middleware';
import { AuthzModule } from './authz/authz.module';
import { HiringModule } from './hiring/hiring.module';
import { CandidateAuthModule } from './candidate-auth/candidate-auth.module';

@Module({
  imports: [DatabaseModule, AuthzModule, HiringModule, CandidateAuthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantResolutionMiddleware)
      .exclude('v1/candidate/(.*)', 'v1/public/(.*)')
      .forRoutes('*');
  }
}

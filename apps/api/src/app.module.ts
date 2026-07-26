import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { TenantResolutionMiddleware } from './database/tenant-transaction.middleware';
import { AuthzModule } from './authz/authz.module';
import { HiringModule } from './hiring/hiring.module';

@Module({
  imports: [DatabaseModule, AuthzModule, HiringModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}

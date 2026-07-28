import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { Pool } from 'pg';
import { PublicController } from './public.controller';
import { PublicJobService } from './public-job.service';
import { PublicTenantResolutionMiddleware } from './public-tenant-resolution.middleware';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PublicController],
  providers: [
    PublicJobService,
    PublicTenantResolutionMiddleware,
    { provide: Pool, useFactory: (db: DatabaseService) => db.pool, inject: [DatabaseService] },
  ],
})
export class PublicModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PublicTenantResolutionMiddleware).forRoutes(PublicController);
  }
}

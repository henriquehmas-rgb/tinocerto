import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { ResumeStructuringService } from './resume-structuring.service';
import { ResumeParsingConsumer } from './resume-parsing.consumer';
import { CandidateApplicationSummaryConsumer } from './candidate-application-summary.consumer';

@Module({
  imports: [DatabaseModule],
  providers: [
    StorageService,
    ResumeStructuringService,
    ResumeParsingConsumer,
    CandidateApplicationSummaryConsumer,
    { provide: Pool, useFactory: (db: DatabaseService) => db.pool, inject: [DatabaseService] },
  ],
})
export class ResumeModule {}

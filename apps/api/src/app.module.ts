import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { TenantResolutionMiddleware } from './database/tenant-transaction.middleware';
import { AuthzModule } from './authz/authz.module';
import { HiringModule } from './hiring/hiring.module';
import { CandidateAuthModule } from './candidate-auth/candidate-auth.module';
import { PublicModule } from './public/public.module';
import { ResumeModule } from './resume/resume.module';
import { AssessmentModule } from './assessment/assessment.module';
import { MatchingModule } from './matching/matching.module';
import { InsightsModule } from './insights/insights.module';
import { LlmRouterModule } from './llm-router/llm-router.module';
import { InterviewModule } from './interview/interview.module';

@Module({
  imports: [
    DatabaseModule,
    AuthzModule,
    LlmRouterModule,
    HiringModule,
    CandidateAuthModule,
    PublicModule,
    ResumeModule,
    AssessmentModule,
    MatchingModule,
    InsightsModule,
    InterviewModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantResolutionMiddleware)
      .exclude('v1/candidate/(.*)', 'v1/public/(.*)')
      .forRoutes('*');
  }
}

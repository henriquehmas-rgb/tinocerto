import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
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
import { CopilotModule } from './copilot/copilot.module';
import { PlatformApiModule } from './platform-api/platform-api.module';

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
    CopilotModule,
    PlatformApiModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantResolutionMiddleware)
      .exclude(
        'v1/candidate/(.*)',
        'v1/public/(.*)',
        'v1/calendar-connections/google/callback',
        // Exato -- NUNCA prefixo/wildcard. Casa só GET /v1/applications
        // (sem segmento adicional); GET /v1/applications/:id (rota de
        // sessão existente) é um path template diferente e continua
        // coberto pelo middleware sem mudança de comportamento.
        { path: 'v1/applications', method: RequestMethod.GET },
        // Exato -- rota nova, sem risco de colidir com nenhuma outra
        // (nenhum controller usa o prefixo v1/assessment-results).
        { path: 'v1/assessment-results/:id/psych-report', method: RequestMethod.GET },
      )
      .forRoutes('*');
  }
}

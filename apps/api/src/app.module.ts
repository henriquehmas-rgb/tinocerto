import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { TenantResolutionMiddleware } from './database/tenant-transaction.middleware';
import { AuthzModule } from './authz/authz.module';
import { HiringModule } from './hiring/hiring.module';
import { CandidateAuthModule } from './candidate-auth/candidate-auth.module';
import { StaffAuthModule } from './staff-auth/staff-auth.module';
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
    StaffAuthModule,
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
        // Wildcard -- documentação pública, sem estado de tenant, mesmo
        // padrão já usado para v1/public/(.*). Nenhum outro controller usa
        // estes dois prefixos, sem risco de exclusão indevida.
        //
        // DESVIO DO PLANO (achado ao verificar manualmente, Task 6 Step 5):
        // o wildcard 'v1/developer/docs/(.*)' exige uma '/' seguida de
        // mais caracteres depois de 'docs' -- não casa a própria rota
        // GET /v1/developer/docs (sem segmento adicional), que é
        // exatamente o path de DeveloperDocsController. Sem a entrada
        // exata abaixo, a página HTML em si devolvia 401
        // 'x-tenant-id ausente' enquanto os assets sob
        // /v1/developer/docs/assets/... (que TÊM segmento adicional)
        // funcionavam normalmente -- confirmado ao vivo com curl.
        'v1/developer/docs',
        'v1/developer/docs/(.*)',
        'v1/developer/openapi-spec/(.*)',
        // Task 7 (StaffAuthModule) -- só estas duas rotas de
        // `StaffAuthController` rodam ANTES de haver tenant/usuário
        // resolvidos: `onboarding` cria o tenant do zero, e `login`/
        // `login/mfa` ainda não sabem a qual tenant o usuário pertence
        // (mesmo raciocínio de `PLACEHOLDER_TENANT` em
        // `candidate-auth.controller.ts`). `refresh`/`logout`/`mfa/setup`/
        // `mfa/verify` continuam cobertas pelo middleware normalmente --
        // exigem tenant/usuário já resolvidos (ver
        // `staff-auth.controller.ts`). Entradas exatas, não
        // `v1/staff/auth/login(.*)`, para não arriscar casar
        // acidentalmente alguma rota futura sob esse prefixo que venha
        // a exigir tenant resolvido.
        'v1/staff/auth/onboarding',
        'v1/staff/auth/login',
        'v1/staff/auth/login/mfa',
      )
      .forRoutes('*');
  }
}

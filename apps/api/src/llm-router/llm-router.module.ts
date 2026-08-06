// apps/api/src/llm-router/llm-router.module.ts
import { Global, Module } from '@nestjs/common';
import { AuditLogService } from '../trust/audit-log.service';
import { AnthropicAdapter, OpenAiAdapter } from './provider-adapter';
import { ModelRouterService } from './model-router.service';

@Global()
@Module({
  providers: [
    {
      provide: ModelRouterService,
      useFactory: () => new ModelRouterService(new AuditLogService(), new AnthropicAdapter(), new OpenAiAdapter()),
    },
  ],
  exports: [ModelRouterService],
})
export class LlmRouterModule {}

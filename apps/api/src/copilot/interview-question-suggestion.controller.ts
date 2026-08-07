// apps/api/src/copilot/interview-question-suggestion.controller.ts
import { Controller, Get, NotFoundException, Param, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ModelRouterUnavailableError } from '../llm-router/model-router.types';
import { InterviewQuestionSuggestionService, InterviewGuideVersionNotFoundError } from './interview-question-suggestion.service';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/interview-guide-versions/:versionId/question-suggestions')
@UseGuards(CerbosGuard)
export class InterviewQuestionSuggestionController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly service: InterviewQuestionSuggestionService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Post()
  @CerbosCheck('interview_guide', 'sugerir_perguntas')
  async gerar(@Req() req: RequestWithAuthContext, @Param('versionId') versionId: string) {
    try {
      return await this.service.gerar({ tenantId: req.tenantId, interviewGuideVersionId: versionId, actorId: req.userId });
    } catch (err) {
      if (err instanceof InterviewGuideVersionNotFoundError) throw new NotFoundException(err.message);
      if (err instanceof ModelRouterUnavailableError) {
        throw new ServiceUnavailableException('Geração de perguntas por IA indisponível no momento -- tente novamente mais tarde.');
      }
      throw err;
    }
  }

  @Get()
  @CerbosCheck('interview_guide', 'read')
  async listar(@Req() req: RequestWithAuthContext, @Param('versionId') versionId: string) {
    return this.tenantContext.run(req.tenantId, (client) => this.service.listar(client, req.tenantId, versionId));
  }
}

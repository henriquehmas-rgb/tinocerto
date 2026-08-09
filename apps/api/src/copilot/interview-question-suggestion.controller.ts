// apps/api/src/copilot/interview-question-suggestion.controller.ts
import { Controller, Get, NotFoundException, Param, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ModelRouterUnavailableError } from '../llm-router/model-router.types';
import { JobRecrutadorService } from '../hiring/job-recrutador.service';
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
    private readonly jobRecrutadorService: JobRecrutadorService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // Item 2 (Critical) da onda 3 de correção pós-revisão: nenhum dos 2
  // handlers deste controller (gerar, listar) chamava
  // JobRecrutadorService.exigirAcesso -- um recrutador sem atribuição
  // podia gerar/listar sugestões de perguntas de entrevista de QUALQUER
  // vaga do tenant. A rota parte de interviewGuideVersionId (não jobId
  // direto) -- resolve interview_guide_version.interview_guide_id ->
  // interview_guide.job_id antes de checar posse. Roda numa
  // TenantContext.run PRÓPRIA (conexão separada da que
  // service.gerar()/listar() abrem internamente), mesmo padrão de
  // CandidateSummaryController.exigirPosseDaCandidatura.
  private async exigirPosseDoRoteiro(req: RequestWithAuthContext, versionId: string): Promise<void> {
    await this.tenantContext.run(req.tenantId, async (client) => {
      const result = await client.query<{ job_id: string }>(
        `SELECT g.job_id
           FROM interview_guide_version v
           JOIN interview_guide g ON g.tenant_id = v.tenant_id AND g.id = v.interview_guide_id
          WHERE v.tenant_id = $1 AND v.id = $2`,
        [req.tenantId, versionId],
      );
      if (result.rows.length === 0) {
        throw new NotFoundException(`interview_guide_version ${versionId} não encontrada para o tenant`);
      }
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: result.rows[0].job_id,
        userId: req.userId,
        userRoles: req.userRoles,
      });
    });
  }

  @Post()
  @CerbosCheck('interview_guide', 'sugerir_perguntas')
  async gerar(@Req() req: RequestWithAuthContext, @Param('versionId') versionId: string) {
    await this.exigirPosseDoRoteiro(req, versionId);
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
    await this.exigirPosseDoRoteiro(req, versionId);
    return this.tenantContext.run(req.tenantId, (client) => this.service.listar(client, req.tenantId, versionId));
  }
}

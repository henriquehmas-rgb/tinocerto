// apps/api/src/copilot/candidate-summary.controller.ts
import { Controller, Get, NotFoundException, Param, Post, Req, ServiceUnavailableException, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ModelRouterUnavailableError } from '../llm-router/model-router.types';
import {
  CandidateSummaryService,
  ApplicationNotFoundError,
  CandidateSummaryInsufficientDataError,
  CandidateSummaryDraftNotFoundError,
} from './candidate-summary.service';
import { CitacaoNaoVerificavelError } from './verify-candidate-summary-citations';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/applications/:applicationId/candidate-summary-drafts')
@UseGuards(CerbosGuard)
export class CandidateSummaryController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly service: CandidateSummaryService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Post()
  @CerbosCheck('application', 'resumo_candidato')
  async gerar(@Req() req: RequestWithAuthContext, @Param('applicationId') applicationId: string) {
    try {
      return await this.service.gerar({ tenantId: req.tenantId, applicationId, actorId: req.userId });
    } catch (err) {
      if (err instanceof ApplicationNotFoundError) throw new NotFoundException(err.message);
      if (err instanceof CandidateSummaryInsufficientDataError) throw new UnprocessableEntityException(err.message);
      if (err instanceof CitacaoNaoVerificavelError) {
        throw new UnprocessableEntityException(
          'Não foi possível gerar um resumo com citações verificáveis para este candidato agora -- tente novamente ou escreva o resumo manualmente.',
        );
      }
      if (err instanceof ModelRouterUnavailableError) {
        throw new ServiceUnavailableException('Geração por IA indisponível no momento -- tente novamente mais tarde.');
      }
      throw err;
    }
  }

  @Get('current')
  @CerbosCheck('application', 'read')
  async atual(@Req() req: RequestWithAuthContext, @Param('applicationId') applicationId: string) {
    return this.tenantContext.run(req.tenantId, (client) => this.service.obterAtual(client, req.tenantId, applicationId));
  }

  @Post(':draftId/apply')
  @CerbosCheck('application', 'aplicar_resumo_candidato')
  async aplicar(
    @Req() req: RequestWithAuthContext,
    @Param('applicationId') applicationId: string,
    @Param('draftId') draftId: string,
  ) {
    try {
      return await this.service.aplicar({ tenantId: req.tenantId, applicationId, draftId, actorId: req.userId });
    } catch (err) {
      if (err instanceof CandidateSummaryDraftNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }
}

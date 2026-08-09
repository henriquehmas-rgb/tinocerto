// apps/api/src/copilot/candidate-summary.controller.ts
import { Controller, Get, NotFoundException, Param, Post, Req, ServiceUnavailableException, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ModelRouterUnavailableError } from '../llm-router/model-router.types';
import { ApplicationService } from '../hiring/application.service';
import { JobRecrutadorService } from '../hiring/job-recrutador.service';
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
    private readonly applicationService: ApplicationService,
    private readonly jobRecrutadorService: JobRecrutadorService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // C3 da revisão de coerência do Painel do Recrutador: as 3 rotas deste
  // controller são liberadas pelo Cerbos para o papel "recrutador" (regras
  // "application"/"resumo_candidato", "application"/"read" e
  // "application"/"aplicar_resumo_candidato"), mas nenhuma tinha guarda de
  // posse por job_recrutador -- um recrutador sem atribuição podia gerar,
  // ler ou aplicar o resumo de IA de QUALQUER candidatura do tenant.
  //
  // As 3 rotas partem de applicationId (não jobId) -- mesmo padrão de
  // AdherenceController.porCandidatura: busca application.jobId via
  // ApplicationService.findByIdWithPersonView, exige posse, só então
  // delega. Roda numa TenantContext.run PRÓPRIA (conexão separada da que
  // service.gerar()/aplicar() abrem internamente) -- não há client
  // compartilhado entre a checagem de posse e a chamada ao service, mas
  // não há necessidade de compartilhar: são operações independentes que já
  // não formavam uma única transação antes desta mudança.
  private async exigirPosseDaCandidatura(req: RequestWithAuthContext, applicationId: string): Promise<void> {
    await this.tenantContext.run(req.tenantId, async (client) => {
      const view = await this.applicationService.findByIdWithPersonView(client, applicationId);
      if (!view) {
        throw new NotFoundException(`Candidatura ${applicationId} não encontrada`);
      }
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: view.jobId,
        userId: req.userId,
        userRoles: req.userRoles,
      });
    });
  }

  @Post()
  @CerbosCheck('application', 'resumo_candidato')
  async gerar(@Req() req: RequestWithAuthContext, @Param('applicationId') applicationId: string) {
    await this.exigirPosseDaCandidatura(req, applicationId);
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
    await this.exigirPosseDaCandidatura(req, applicationId);
    return this.tenantContext.run(req.tenantId, (client) => this.service.obterAtual(client, req.tenantId, applicationId));
  }

  @Post(':draftId/apply')
  @CerbosCheck('application', 'aplicar_resumo_candidato')
  async aplicar(
    @Req() req: RequestWithAuthContext,
    @Param('applicationId') applicationId: string,
    @Param('draftId') draftId: string,
  ) {
    await this.exigirPosseDaCandidatura(req, applicationId);
    try {
      return await this.service.aplicar({ tenantId: req.tenantId, applicationId, draftId, actorId: req.userId });
    } catch (err) {
      if (err instanceof CandidateSummaryDraftNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }
}

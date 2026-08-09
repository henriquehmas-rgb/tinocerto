import { Body, Controller, Get, Param, Post, Req, UseGuards, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { IsDateString, IsNotEmpty, IsOptional, IsString, Matches, isUUID } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ApplicationService } from './application.service';
import { PipelineStageTransitionService } from './pipeline-stage-transition.service';
import { DecisionService } from './decision.service';
import { OfferService, OfertaPendenteExistenteError } from './offer.service';
import { ApplicationStartedWorkService, NenhumaOfertaAceitaError, InicioTrabalhoJaRegistradoError } from './application-started-work.service';
import { JobRecrutadorService } from './job-recrutador.service';
import { ReportService } from '../assessment/report/report.service';
import { AdherenceService } from '../matching/adherence.service';

class MoveStageDto {
  @IsString()
  @IsNotEmpty()
  toState!: string;

  @IsOptional()
  @IsString()
  reasonCode?: string;
}

class RejectApplicationDto {
  @IsOptional()
  @IsString()
  motivoCodigo?: string;
}

class ExtendOfferDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'valor deve ser um decimal com até 2 casas (ex.: "8500.00")' })
  valor!: string;
}

class MarkStartedWorkDto {
  @IsDateString()
  startDate!: string;
}

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

// CerbosGuard (Task 6, apps/api/src/authz/cerbos.guard.ts) monta o
// resource.attr.tenant_id enviado ao Cerbos a partir do próprio req.tenantId
// do requisitante -- nunca de um lookup real do tenant dono do `:id` da
// rota. Isso faz a regra "bloqueio-tenant-diferente" (deny-overrides) do
// Cerbos nunca disparar aqui, pois principal.attr.tenant_id e
// resource.attr.tenant_id são sempre o mesmo valor por construção (achado de
// revisão adversarial do Task 12; a correção arquitetural do guard em si --
// buscar o tenant_id real do recurso no banco antes de chamar o Cerbos -- é
// um ticket à parte, pois afeta todo guard-mediated action do sistema, não
// só esta rota).
//
// Quem de fato impede a escrita cross-tenant nesta rota é a FK composta
// `fk_decision_tenant_application` (tenant_id, application_id) ->
// application (tenant_id, id): uma tentativa de reject numa candidatura de
// outro tenant estoura essa constraint com um 23503 (foreign_key_violation)
// do Postgres. Sem tratar isso explicitamente, esse erro vazaria como 500
// não tratado para o cliente da API -- uma garantia de segurança (bloquear
// acesso cross-tenant) degradaria para um bug de robustez de API. A função
// abaixo detecta especificamente essa violação para traduzi-la num 404
// limpo (mesma semântica de `findOne`: da perspectiva de quem chama, a
// candidatura simplesmente não existe neste tenant). extend-offer usa o
// mesmo tratamento contra fk_offer_tenant_application (hiring_0015).
function isForeignKeyViolation(err: unknown, constraintName: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === '23503' &&
    (err as { constraint?: unknown }).constraint === constraintName
  );
}

@Controller('v1/applications')
@UseGuards(CerbosGuard)
export class ApplicationController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly applicationService: ApplicationService,
    private readonly pipelineStageTransitionService: PipelineStageTransitionService,
    private readonly decisionService: DecisionService,
    private readonly offerService: OfferService,
    private readonly applicationStartedWorkService: ApplicationStartedWorkService,
    private readonly jobRecrutadorService: JobRecrutadorService,
    private readonly reportService: ReportService,
    private readonly adherenceService: AdherenceService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get(':id')
  @CerbosCheck('application', 'read')
  async findOne(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    return this.tenantContext.run(req.tenantId, async (client) => {
      const view = await this.applicationService.findByIdWithPersonView(client, id);
      if (!view) {
        throw new NotFoundException(`Candidatura ${id} não encontrada`);
      }
      // Guarda de posse por recrutador (Fase 5a, Task 4): mesma
      // JobRecrutadorService.exigirAcesso usada pelas rotas de JobController
      // (Task 3) -- papéis com acesso total (admin_tenant, gestor_vaga)
      // passam sempre; papel recrutador só passa se atribuído a esta vaga
      // via job_recrutador. 404 (não 403), mesmo raciocínio já documentado
      // em exigirAcesso, para não revelar a existência da candidatura/vaga
      // a quem não tem acesso.
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: view.jobId,
        userId: req.userId,
        userRoles: req.userRoles,
      });
      return view;
    });
  }

  @Post(':id/actions/move-stage')
  @CerbosCheck('application', 'move-stage')
  async moveStage(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: MoveStageDto) {
    return this.tenantContext.run(req.tenantId, async (client) => {
      const view = await this.applicationService.findByIdWithPersonView(client, id);
      if (!view) {
        throw new NotFoundException(`Candidatura ${id} não encontrada`);
      }
      // Guarda de posse por recrutador (Fase 5a, Task 4) -- roda ANTES da
      // checagem de UUID de req.userId abaixo, de propósito: uma tentativa
      // de acesso sem posse deve sempre virar 404 (não revelar a
      // existência da candidatura), independente de o userId do
      // requisitante estar bem formado ou não. Mesma guarda de findOne
      // acima -- ver comentário lá para o raciocínio completo.
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: view.jobId,
        userId: req.userId,
        userRoles: req.userRoles,
      });
      // req.userId vem do payload do JWT de staff verificado por
      // TenantResolutionMiddleware (StaffJwtService.verify -- Task 8),
      // sempre um uuid genuíno emitido pelo próprio backend no login. Esta
      // checagem sobrevive como defesa em profundidade:
      // pipeline_stage_transition.actor_id é uuid NOT NULL, e um userId em
      // formato inesperado (ex. dado de teste malformado) causaria um
      // 22P02 não tratado do Postgres, virando 500 para uma ação de
      // mover-etapa que deveria ser rotineira e permitida.
      if (!isUUID(req.userId)) {
        throw new BadRequestException('userId do token de autenticação deve ser um UUID válido para registrar a transição de etapa');
      }
      return this.pipelineStageTransitionService.moveStage(client, {
        applicationId: id,
        toState: dto.toState,
        reasonCode: dto.reasonCode,
        actorId: req.userId,
        actorType: 'user',
      });
    });
  }

  @Get(':id/assessment-report')
  @CerbosCheck('application', 'read')
  async assessmentReport(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    return this.tenantContext.run(req.tenantId, async (client) => {
      const application = await this.applicationService.findByIdWithPersonView(client, id);
      if (!application) {
        throw new NotFoundException(`Candidatura ${id} não encontrada`);
      }
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: application.jobId,
        userId: req.userId,
        userRoles: req.userRoles,
      });

      // Versão simplificada e específica desta rota do predicado
      // RESULT_GRANT_LIVE_EXISTS (apps/api/src/talent/result-grant-predicate.ts):
      // não reutiliza a constante compartilhada diretamente porque ela
      // assume o alias `r` de assessment_result no FROM do chamador (usado
      // por ReportService.gerar/PsychReportService.obterIntegra, que já
      // partem de um assessment_result_id conhecido), o que não se aplica
      // aqui -- esta rota parte de application_id e ainda não sabe qual
      // assessment_result_id (se algum) está associado. Mantém as mesmas 6
      // condições de validade que o predicado documenta (tenant do grant,
      // não revogado, não expirado, consent não revogado, consent dentro
      // do ttl_meses, coerência de tenant entre grant e consent) para não
      // reabrir a lacuna de segurança que RESULT_GRANT_LIVE_EXISTS existe
      // para fechar.
      const grantResult = await client.query<{ assessment_result_id: string }>(
        `SELECT g.assessment_result_id
         FROM result_grant g
         JOIN consent c ON c.id = g.consent_id
         WHERE g.tenant_id = $1
           AND g.application_id = $2
           AND g.revoked_at IS NULL
           AND (g.expires_at IS NULL OR g.expires_at > now())
           AND c.revoked_at IS NULL
           AND (c.ttl_meses IS NULL OR c.granted_at + (c.ttl_meses * interval '1 month') > now())
           AND (c.tenant_id IS NULL OR c.tenant_id = g.tenant_id)
         LIMIT 1`,
        [req.tenantId, id],
      );

      const relatorio =
        grantResult.rows.length > 0 ? await this.reportService.gerar(client, grantResult.rows[0].assessment_result_id) : null;
      const aderencia = await this.adherenceService.porCandidatura(client, id);

      return { relatorio, aderencia };
    });
  }

  @Post(':id/actions/reject')
  @CerbosCheck('application', 'reject')
  async reject(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: RejectApplicationDto) {
    try {
      return await this.tenantContext.run(req.tenantId, async (client) => {
        const view = await this.applicationService.findByIdWithPersonView(client, id);
        if (!view) {
          throw new NotFoundException(`Candidatura ${id} não encontrada`);
        }
        // Guarda de posse por recrutador (Fase 5a, Task 4; achado Critical
        // da revisão da onda 1 -- esta rota é explorável diretamente pela
        // API, independente de estar consumida pelo painel ou não). Mesmo
        // padrão de findOne/moveStage/assessment-report acima.
        await this.jobRecrutadorService.exigirAcesso(client, {
          tenantId: req.tenantId,
          jobId: view.jobId,
          userId: req.userId,
          userRoles: req.userRoles,
        });
        return this.decisionService.record(client, {
          tenantId: req.tenantId,
          applicationId: id,
          tipo: 'reprovacao',
          motivoCodigo: dto.motivoCodigo,
          decidoPor: req.userId,
        });
      });
    } catch (err) {
      // Ver comentário de isForeignKeyViolation no topo do arquivo.
      if (isForeignKeyViolation(err, 'fk_decision_tenant_application')) {
        throw new NotFoundException(`Candidatura ${id} não encontrada`);
      }
      throw err;
    }
  }

  @Post(':id/actions/extend-offer')
  @CerbosCheck('offer', 'extend')
  async extendOffer(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: ExtendOfferDto) {
    try {
      return await this.tenantContext.run(req.tenantId, async (client) => {
        const view = await this.applicationService.findByIdWithPersonView(client, id);
        if (!view) {
          throw new NotFoundException(`Candidatura ${id} não encontrada`);
        }
        // Guarda de posse por recrutador (Fase 5a, Task 4; achado Critical
        // da revisão da onda 1). Mesmo padrão de findOne/moveStage acima.
        await this.jobRecrutadorService.exigirAcesso(client, {
          tenantId: req.tenantId,
          jobId: view.jobId,
          userId: req.userId,
          userRoles: req.userRoles,
        });
        return this.offerService.extend(client, {
          tenantId: req.tenantId,
          applicationId: id,
          valor: dto.valor,
          estendidoPor: req.userId,
        });
      });
    } catch (err) {
      if (isForeignKeyViolation(err, 'fk_offer_tenant_application')) {
        throw new NotFoundException(`Candidatura ${id} não encontrada`);
      }
      if (err instanceof OfertaPendenteExistenteError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }

  @Get(':id/offers')
  @CerbosCheck('offer', 'read')
  async listOffers(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    return this.tenantContext.run(req.tenantId, async (client) => {
      const view = await this.applicationService.findByIdWithPersonView(client, id);
      if (!view) {
        throw new NotFoundException(`Candidatura ${id} não encontrada`);
      }
      // Guarda de posse por recrutador (Fase 5a, Task 4; achado Critical
      // da revisão da onda 1). Mesmo padrão de findOne/moveStage acima.
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: view.jobId,
        userId: req.userId,
        userRoles: req.userRoles,
      });
      return this.offerService.listByApplication(client, req.tenantId, id);
    });
  }

  @Post(':id/actions/mark-started-work')
  @CerbosCheck('application', 'mark-started-work')
  async markStartedWork(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: MarkStartedWorkDto) {
    try {
      return await this.tenantContext.run(req.tenantId, async (client) => {
        const view = await this.applicationService.findByIdWithPersonView(client, id);
        if (!view) {
          throw new NotFoundException(`Candidatura ${id} não encontrada`);
        }
        // Guarda de posse por recrutador (Fase 5a, Task 4; achado Critical
        // da revisão da onda 1). Mesmo padrão de findOne/moveStage acima.
        await this.jobRecrutadorService.exigirAcesso(client, {
          tenantId: req.tenantId,
          jobId: view.jobId,
          userId: req.userId,
          userRoles: req.userRoles,
        });
        return this.applicationStartedWorkService.registrar(client, {
          tenantId: req.tenantId,
          applicationId: id,
          startDate: dto.startDate,
          registradoPor: req.userId,
        });
      });
    } catch (err) {
      if (err instanceof NenhumaOfertaAceitaError || err instanceof InicioTrabalhoJaRegistradoError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }
}

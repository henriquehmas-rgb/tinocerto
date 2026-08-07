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
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get(':id')
  @CerbosCheck('application', 'read')
  async findOne(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    const view = await this.tenantContext.run(req.tenantId, (client) =>
      this.applicationService.findByIdWithPersonView(client, id),
    );
    if (!view) {
      throw new NotFoundException(`Candidatura ${id} não encontrada`);
    }
    return view;
  }

  @Post(':id/actions/move-stage')
  @CerbosCheck('application', 'move-stage')
  async moveStage(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: MoveStageDto) {
    // req.userId vem do header x-user-id (TenantResolutionMiddleware), que só
    // valida presença, não formato -- dívida técnica aceita na Task 6 até a
    // autenticação real entrar. pipeline_stage_transition.actor_id, porém, é
    // uuid NOT NULL: sem esta checagem, um x-user-id não-UUID (ex.: os
    // próprios literais 'recrutador-1'/'user-1' usados nos fixtures de teste
    // desta fase) causaria um 22P02 não tratado do Postgres, virando 500 para
    // uma ação de mover-etapa que deveria ser rotineira e permitida.
    if (!isUUID(req.userId)) {
      throw new BadRequestException('x-user-id deve ser um UUID válido para registrar a transição de etapa');
    }
    return this.tenantContext.run(req.tenantId, (client) =>
      this.pipelineStageTransitionService.moveStage(client, {
        applicationId: id,
        toState: dto.toState,
        reasonCode: dto.reasonCode,
        actorId: req.userId,
        actorType: 'user',
      }),
    );
  }

  @Post(':id/actions/reject')
  @CerbosCheck('application', 'reject')
  async reject(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: RejectApplicationDto) {
    try {
      return await this.tenantContext.run(req.tenantId, (client) =>
        this.decisionService.record(client, {
          tenantId: req.tenantId,
          applicationId: id,
          tipo: 'reprovacao',
          motivoCodigo: dto.motivoCodigo,
          decidoPor: req.userId,
        }),
      );
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
      return await this.tenantContext.run(req.tenantId, (client) =>
        this.offerService.extend(client, {
          tenantId: req.tenantId,
          applicationId: id,
          valor: dto.valor,
          estendidoPor: req.userId,
        }),
      );
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
    return this.tenantContext.run(req.tenantId, (client) => this.offerService.listByApplication(client, req.tenantId, id));
  }

  @Post(':id/actions/mark-started-work')
  @CerbosCheck('application', 'mark-started-work')
  async markStartedWork(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: MarkStartedWorkDto) {
    try {
      return await this.tenantContext.run(req.tenantId, (client) =>
        this.applicationStartedWorkService.registrar(client, {
          tenantId: req.tenantId,
          applicationId: id,
          startDate: dto.startDate,
          registradoPor: req.userId,
        }),
      );
    } catch (err) {
      if (err instanceof NenhumaOfertaAceitaError || err instanceof InicioTrabalhoJaRegistradoError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }
}

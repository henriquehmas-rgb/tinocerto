import { Body, Controller, Get, Param, Post, Req, UseGuards, NotFoundException, BadRequestException } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, isUUID } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ApplicationService } from './application.service';
import { PipelineStageTransitionService } from './pipeline-stage-transition.service';
import { DecisionService } from './decision.service';

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

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/applications')
@UseGuards(CerbosGuard)
export class ApplicationController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly applicationService: ApplicationService,
    private readonly pipelineStageTransitionService: PipelineStageTransitionService,
    private readonly decisionService: DecisionService,
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
    return this.tenantContext.run(req.tenantId, (client) =>
      this.decisionService.record(client, {
        tenantId: req.tenantId,
        applicationId: id,
        tipo: 'reprovacao',
        motivoCodigo: dto.motivoCodigo,
        decidoPor: req.userId,
      }),
    );
  }
}

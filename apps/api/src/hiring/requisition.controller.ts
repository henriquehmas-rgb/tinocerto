import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { RequisitionService } from './requisition.service';

class OpenRequisitionDto {
  @IsUUID()
  orgUnitId!: string;

  @IsString()
  @IsNotEmpty()
  titulo!: string;
}

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/requisitions')
@UseGuards(CerbosGuard)
export class RequisitionController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly requisitionService: RequisitionService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // C3 da revisão de coerência do Painel do Recrutador: não existia
  // NENHUMA rota para listar requisições -- o formulário de criar vaga não
  // tinha como descobrir o id da requisition inicial que o onboarding
  // agora cria (ver StaffOnboardingService.onboard). Lista todas as
  // requisições do tenant (não filtra por status -- o frontend decide como
  // exibir/filtrar). Sem guarda de posse: requisição não tem conceito de
  // recrutador atribuído (job_recrutador é por VAGA), só o
  // @CerbosCheck('requisition', 'read') já coberto pela regra
  // "gestao-requisicao" (admin_tenant, recrutador) em resource_requisition.yaml.
  @Get()
  @CerbosCheck('requisition', 'read')
  async listar(@Req() req: RequestWithAuthContext) {
    return this.tenantContext.run(req.tenantId, (client) => this.requisitionService.listar(client, req.tenantId));
  }

  @Post()
  @CerbosCheck('requisition', 'create')
  async create(@Req() req: RequestWithAuthContext, @Body() dto: OpenRequisitionDto) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.requisitionService.open(client, {
        tenantId: req.tenantId,
        orgUnitId: dto.orgUnitId,
        titulo: dto.titulo,
      }),
    );
  }

  @Post(':id/actions/approve')
  @CerbosCheck('requisition', 'approve')
  async approve(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    await this.tenantContext.run(req.tenantId, (client) =>
      this.requisitionService.approve(client, id, req.userId),
    );
    return { id, status: 'aprovada' };
  }
}

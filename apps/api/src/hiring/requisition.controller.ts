import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
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

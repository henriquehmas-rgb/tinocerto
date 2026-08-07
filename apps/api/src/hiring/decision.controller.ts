import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { DecisionService } from './decision.service';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/decisions')
@UseGuards(CerbosGuard)
export class DecisionController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly decisionService: DecisionService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get('revisoes-pendentes')
  @CerbosCheck('decision', 'read')
  async revisoesPendentes(@Req() req: RequestWithAuthContext) {
    return this.tenantContext.run(req.tenantId, (client) => this.decisionService.listarRevisoesPendentes(client, req.tenantId));
  }
}

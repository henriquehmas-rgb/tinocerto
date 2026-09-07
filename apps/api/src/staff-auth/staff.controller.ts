import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { StaffAccountService } from './staff-account.service';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

// Controller separado de StaffAuthController: v1/staff/auth é só fluxo de
// autenticação (onboarding/login/mfa/refresh/me/logout, nenhum deles usa
// Cerbos); v1/staff é um recurso de negócio (a equipe do tenant), então
// segue o mesmo padrão de JobController/RequisitionController --
// @UseGuards(CerbosGuard) + @CerbosCheck por rota.
@Controller('v1/staff')
@UseGuards(CerbosGuard)
export class StaffController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly staffAccountService: StaffAccountService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get()
  @CerbosCheck('staff', 'list')
  async listar(@Req() req: RequestWithAuthContext) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.staffAccountService.listarEquipe(client, req.tenantId),
    );
  }
}

import { Controller, Get, NotFoundException, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { AdherenceService } from './adherence.service';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/applications')
@UseGuards(CerbosGuard)
export class AdherenceController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly adherenceService: AdherenceService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get(':id/adherence')
  @CerbosCheck('application', 'read')
  async porCandidatura(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    const score = await this.tenantContext.run(req.tenantId, (client) =>
      this.adherenceService.porCandidatura(client, id),
    );
    if (!score) {
      throw new NotFoundException(`Candidatura ${id} não encontrada`);
    }
    return score;
  }
}

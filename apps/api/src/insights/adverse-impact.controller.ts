import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { AdverseImpactSnapshotService } from './adverse-impact-snapshot.service';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/jobs')
@UseGuards(CerbosGuard)
export class AdverseImpactController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly snapshotService: AdverseImpactSnapshotService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get(':id/adverse-impact')
  @CerbosCheck('job', 'read')
  async porVaga(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    return this.tenantContext.run(req.tenantId, (client) => this.snapshotService.listarPorVaga(client, id));
  }
}

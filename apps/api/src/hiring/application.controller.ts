import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { NotFoundException } from '@nestjs/common';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ApplicationService } from './application.service';

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
}

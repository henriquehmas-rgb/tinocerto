import { Controller, Get, NotFoundException, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { PublicJobService } from './public-job.service';

interface RequestWithTenant extends Request {
  tenantId: string;
}

@Controller('v1/public/careers/:tenantSlug')
export class PublicController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly publicJobService: PublicJobService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get('jobs')
  async listJobs(@Req() req: RequestWithTenant) {
    return this.tenantContext.run(req.tenantId, (client) => this.publicJobService.listPublished(client, req.tenantId));
  }

  @Get('jobs/:jobSlug')
  async findJob(@Req() req: RequestWithTenant, @Param('jobSlug') jobSlug: string) {
    const job = await this.tenantContext.run(req.tenantId, (client) =>
      this.publicJobService.findPublicBySlug(client, req.tenantId, jobSlug),
    );
    if (!job) {
      throw new NotFoundException('Vaga não encontrada');
    }
    return job;
  }
}

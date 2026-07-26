import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { JobService } from './job.service';

class CreateJobDto {
  @IsUUID()
  requisitionId!: string;

  @IsString()
  @IsNotEmpty()
  titulo!: string;
}

class PublishJobDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  canais!: string[];
}

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/jobs')
@UseGuards(CerbosGuard)
export class JobController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly jobService: JobService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Post()
  @CerbosCheck('job', 'create')
  async create(@Req() req: RequestWithAuthContext, @Body() dto: CreateJobDto) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.jobService.create(client, {
        tenantId: req.tenantId,
        requisitionId: dto.requisitionId,
        titulo: dto.titulo,
      }),
    );
  }

  @Post(':id/actions/publish')
  @CerbosCheck('job', 'publish')
  async publish(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: PublishJobDto) {
    await this.tenantContext.run(req.tenantId, (client) => this.jobService.publish(client, id, dto.canais));
    return { id, status: 'publicada' };
  }
}

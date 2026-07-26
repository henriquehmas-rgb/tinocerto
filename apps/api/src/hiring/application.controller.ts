import { Body, Controller, Get, Param, Post, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ApplicationService } from './application.service';
import { PipelineStageTransitionService } from './pipeline-stage-transition.service';

class MoveStageDto {
  @IsString()
  @IsNotEmpty()
  toState!: string;

  @IsOptional()
  @IsString()
  reasonCode?: string;
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
}

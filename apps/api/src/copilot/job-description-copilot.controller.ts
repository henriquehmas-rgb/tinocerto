// apps/api/src/copilot/job-description-copilot.controller.ts
import { Controller, ConflictException, Get, NotFoundException, Param, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ModelRouterUnavailableError } from '../llm-router/model-router.types';
import {
  JobDescriptionCopilotService,
  JobNotFoundError,
  JobDescriptionSuggestionNotFoundError,
  JobDescriptionSuggestionStaleError,
} from './job-description-copilot.service';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/jobs/:jobId/description-suggestions')
@UseGuards(CerbosGuard)
export class JobDescriptionCopilotController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly service: JobDescriptionCopilotService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Post()
  @CerbosCheck('job', 'rewrite_description')
  async gerar(@Req() req: RequestWithAuthContext, @Param('jobId') jobId: string) {
    try {
      return await this.service.sugerir({ tenantId: req.tenantId, jobId, actorId: req.userId });
    } catch (err) {
      if (err instanceof JobNotFoundError) throw new NotFoundException(err.message);
      if (err instanceof ModelRouterUnavailableError) {
        throw new ServiceUnavailableException('Geração por IA indisponível no momento -- tente novamente mais tarde.');
      }
      throw err;
    }
  }

  @Get()
  @CerbosCheck('job', 'read')
  async listar(@Req() req: RequestWithAuthContext, @Param('jobId') jobId: string) {
    return this.tenantContext.run(req.tenantId, (client) => this.service.listar(client, req.tenantId, jobId));
  }

  @Post(':suggestionId/apply')
  @CerbosCheck('job', 'apply_description')
  async aplicar(
    @Req() req: RequestWithAuthContext,
    @Param('jobId') jobId: string,
    @Param('suggestionId') suggestionId: string,
  ) {
    try {
      return await this.service.aplicar({ tenantId: req.tenantId, jobId, suggestionId, actorId: req.userId });
    } catch (err) {
      if (err instanceof JobDescriptionSuggestionNotFoundError) throw new NotFoundException(err.message);
      if (err instanceof JobDescriptionSuggestionStaleError) throw new ConflictException(err.message);
      throw err;
    }
  }
}

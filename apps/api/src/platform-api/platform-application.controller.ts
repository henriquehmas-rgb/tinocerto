import { Controller, Get, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { ApplicationService } from '../hiring/application.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ApiKeyGuard, RequestWithApiKeyContext } from './api-key.guard';
import { PlatformApiExceptionFilter } from './platform-api-exception.filter';
import { decodeCursor, encodeCursor } from './cursor-pagination';

class ListApplicationsQuery {
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @IsOptional()
  @IsString()
  stage?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;

  @IsOptional()
  @IsString()
  cursor?: string;
}

// Prefixo v1/applications é o MESMO usado por ApplicationController
// (src/hiring/), em outra classe -- não há colisão de rota (ver design
// spec §1): esta classe só registra GET /v1/applications (sem :id), que
// ApplicationController nunca registrou.
@Controller('v1/applications')
@UseGuards(ApiKeyGuard, CerbosGuard)
@UseFilters(PlatformApiExceptionFilter)
export class PlatformApplicationController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly applicationService: ApplicationService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get()
  @CerbosCheck('application', 'read')
  async list(@Req() req: RequestWithApiKeyContext, @Query() query: ListApplicationsQuery) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    const { items, hasMore } = await this.tenantContext.run(req.tenantId, (client) =>
      this.applicationService.listByCursor(client, {
        jobId: query.jobId,
        stage: query.stage,
        limit: query.limit,
        cursor,
      }),
    );

    const last = items[items.length - 1];
    return {
      data: items.map((item) => ({
        id: item.id,
        job_id: item.jobId,
        candidate_id: item.candidateId,
        stage: item.stage,
        created_at: item.createdAt.toISOString(),
      })),
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor({ sortValue: last.createdAt.toISOString(), id: last.id }) : null,
    };
  }
}

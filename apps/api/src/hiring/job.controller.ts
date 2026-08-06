import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  habilidadesExigidas?: string[];
}

class PublishJobDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  canais!: string[];
}

class DeclararHabilidadesExigidasDto {
  @IsArray()
  @IsString({ each: true })
  // Achado de revisão final da Fase 2b: sem isto, ["React", ""] era aceito
  // e virava um requisito-fantasma vazio que dilui o score de todo
  // candidato (toda skill normaliza para string vazia via trim(), então
  // "" sempre bate com "" -- ver LIMITE CONHECIDO em adherence-scoring.ts).
  @IsNotEmpty({ each: true })
  habilidades!: string[];
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
        habilidadesExigidas: dto.habilidadesExigidas,
      }),
    );
  }

  @Post(':id/actions/publish')
  @CerbosCheck('job', 'publish')
  async publish(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: PublishJobDto) {
    await this.tenantContext.run(req.tenantId, (client) => this.jobService.publish(client, id, dto.canais));
    return { id, status: 'publicada' };
  }

  @Post(':id/actions/declarar-habilidades-exigidas')
  @CerbosCheck('job', 'update')
  async declararHabilidadesExigidas(
    @Req() req: RequestWithAuthContext,
    @Param('id') id: string,
    @Body() dto: DeclararHabilidadesExigidasDto,
  ) {
    await this.tenantContext.run(req.tenantId, (client) =>
      this.jobService.declararHabilidadesExigidas(client, id, dto.habilidades),
    );
    return { id, habilidadesExigidas: dto.habilidades };
  }
}

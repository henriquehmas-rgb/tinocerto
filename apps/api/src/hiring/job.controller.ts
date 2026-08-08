import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { JobService } from './job.service';
import { JobRecrutadorService } from './job-recrutador.service';

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recrutadorIds?: string[];
}

class AtribuirRecrutadoresDto {
  @IsArray()
  @IsString({ each: true })
  recrutadorIds!: string[];
}

class EditarJobDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  titulo?: string;

  @IsOptional()
  @IsString()
  descricao?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
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
    private readonly jobRecrutadorService: JobRecrutadorService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get()
  @CerbosCheck('job', 'read')
  async list(@Req() req: RequestWithAuthContext) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.jobService.listar(client, { tenantId: req.tenantId, userId: req.userId, userRoles: req.userRoles }),
    );
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
        recrutadorIds: dto.recrutadorIds,
      }),
    );
  }

  @Post(':id/actions/atribuir-recrutadores')
  @CerbosCheck('job', 'update')
  async atribuirRecrutadores(
    @Req() req: RequestWithAuthContext,
    @Param('id') id: string,
    @Body() dto: AtribuirRecrutadoresDto,
  ) {
    await this.tenantContext.run(req.tenantId, async (client) => {
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: id,
        userId: req.userId,
        userRoles: req.userRoles,
      });
      await this.jobRecrutadorService.atribuir(client, {
        tenantId: req.tenantId,
        jobId: id,
        recrutadorIds: dto.recrutadorIds,
      });
    });
    return { id, recrutadorIds: dto.recrutadorIds };
  }

  @Patch(':id')
  @CerbosCheck('job', 'update')
  async editar(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: EditarJobDto) {
    await this.tenantContext.run(req.tenantId, async (client) => {
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: id,
        userId: req.userId,
        userRoles: req.userRoles,
      });
      await this.jobService.editar(client, { tenantId: req.tenantId, jobId: id, ...dto });
    });
    return { id };
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

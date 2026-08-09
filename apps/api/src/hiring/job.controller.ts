import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards, NotFoundException } from '@nestjs/common';
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

export class AtribuirRecrutadoresDto {
  @IsArray()
  // Achado I4 da revisão de coerência do Painel do Recrutador: um id
  // não-UUID aqui passava direto para o INSERT em job_recrutador e
  // estourava um 500 não tratado do Postgres (22P02, invalid input syntax
  // for type uuid). @IsUUID rejeita com 400 já no ValidationPipe global
  // (main.ts), antes de qualquer query.
  @IsUUID('4', { each: true })
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
    // Achado C1 da revisão de coerência do Painel do Recrutador: sem isto,
    // uma vaga criada sem recrutadorIds explícitos no body nascia sem
    // NENHUM recrutador atribuído -- nem o próprio criador, que ficava
    // trancado fora da própria vaga (404 em tudo, sem conseguir se
    // auto-atribuir via atribuirRecrutadores, que já exige posse antes de
    // atribuir). Inclui SEMPRE req.userId no conjunto de recrutadores,
    // deduplicado com o que o body já trouxer -- independe do papel de quem
    // cria: para admin_tenant/gestor_vaga é inócuo (já têm acesso total via
    // PAPEIS_COM_ACESSO_TOTAL), para recrutador é o que garante posse
    // imediata sobre a vaga recém-criada.
    const recrutadorIds = Array.from(new Set([req.userId, ...(dto.recrutadorIds ?? [])]));
    return this.tenantContext.run(req.tenantId, (client) =>
      this.jobService.create(client, {
        tenantId: req.tenantId,
        requisitionId: dto.requisitionId,
        titulo: dto.titulo,
        habilidadesExigidas: dto.habilidadesExigidas,
        recrutadorIds,
      }),
    );
  }

  @Get(':id')
  @CerbosCheck('job', 'read')
  async findOne(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    return this.tenantContext.run(req.tenantId, async (client) => {
      // Guarda de posse por recrutador (Fase 5a, fix C4 pré-requisito):
      // mesmo padrão de funil/editar/atribuirRecrutadores acima -- roda
      // ANTES da leitura para não vazar a existência da vaga a quem não
      // tem acesso (404, não 403).
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: id,
        userId: req.userId,
        userRoles: req.userRoles,
      });
      const job = await this.jobService.findById(client, { tenantId: req.tenantId, jobId: id });
      if (!job) {
        throw new NotFoundException(`Vaga ${id} não encontrada`);
      }
      const recrutadorIds = await this.jobRecrutadorService.listarPorVaga(client, { tenantId: req.tenantId, jobId: id });
      return { ...job, recrutadorIds };
    });
  }

  @Get(':id/funil')
  @CerbosCheck('job', 'read')
  async funil(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    return this.tenantContext.run(req.tenantId, async (client) => {
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: id,
        userId: req.userId,
        userRoles: req.userRoles,
      });
      return this.jobService.funil(client, { tenantId: req.tenantId, jobId: id });
    });
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
    await this.tenantContext.run(req.tenantId, async (client) => {
      // Achado C2 da revisão de coerência do Painel do Recrutador: o Cerbos
      // libera o papel "recrutador" para esta rota (mesma regra
      // "gestao-vaga" de create/read/update), mas a guarda de posse por
      // job_recrutador nunca tinha sido aplicada aqui -- um recrutador sem
      // atribuição podia publicar QUALQUER vaga do tenant via chamada
      // direta à API. Mesma guarda de funil/editar acima.
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: id,
        userId: req.userId,
        userRoles: req.userRoles,
      });
      await this.jobService.publish(client, id, dto.canais);
    });
    return { id, status: 'publicada' };
  }

  @Post(':id/actions/declarar-habilidades-exigidas')
  @CerbosCheck('job', 'update')
  async declararHabilidadesExigidas(
    @Req() req: RequestWithAuthContext,
    @Param('id') id: string,
    @Body() dto: DeclararHabilidadesExigidasDto,
  ) {
    await this.tenantContext.run(req.tenantId, async (client) => {
      // Mesmo achado C2 documentado em publish() acima -- guarda de posse
      // que faltava nesta rota.
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: id,
        userId: req.userId,
        userRoles: req.userRoles,
      });
      await this.jobService.declararHabilidadesExigidas(client, id, dto.habilidades);
    });
    return { id, habilidadesExigidas: dto.habilidades };
  }
}

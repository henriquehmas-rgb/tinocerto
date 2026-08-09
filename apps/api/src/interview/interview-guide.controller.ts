import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IsArray, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { JobRecrutadorService } from '../hiring/job-recrutador.service';
import { InterviewGuideService, InterviewGuideNotFoundError, InterviewGuidePublishEmptyError } from './interview-guide.service';
import { BarsGenerationService } from './bars-generation.service';
import { ModelRouterUnavailableError } from '../llm-router/model-router.types';

class AncoraDto {
  @IsNotEmpty() nivel!: number;
  @IsString() @IsNotEmpty() descricaoComportamental!: string;
}

class CompetenciaDto {
  @IsString() @IsNotEmpty() nome!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => AncoraDto) ancoras!: AncoraDto[];
}

class CriarRascunhoDto {
  @IsString() @IsNotEmpty() jobId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => CompetenciaDto) competencias!: CompetenciaDto[];
}

class EditarRascunhoDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CompetenciaDto) competencias!: CompetenciaDto[];
}

class GerarRascunhoDto {
  @IsString() @IsNotEmpty() jobId!: string;
  // [Fix 5 da revisão final] Limites explícitos de tamanho -- sem eles, um
  // recrutador autenticado podia postar texto arbitrariamente grande
  // repetidamente contra uma chamada de LLM tier-2 faturada. Rate-limiting
  // geral (frequência de requisições) é uma lacuna pré-existente do
  // projeto inteiro (sem @nestjs/throttler em lugar nenhum) e fica fora do
  // escopo aqui -- este limite só cobre o custo por requisição.
  @IsString() @IsNotEmpty() @MaxLength(200) tituloVaga!: string;
  @IsString() @IsNotEmpty() @MaxLength(20000) textoRequisicao!: string;
}

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/interview-guides')
@UseGuards(CerbosGuard)
export class InterviewGuideController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly guideService: InterviewGuideService,
    databaseService: DatabaseService,
    private readonly barsGenerationService: BarsGenerationService,
    private readonly jobRecrutadorService: JobRecrutadorService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // Item 3 da onda 3 de correção pós-revisão: nenhuma das 4 rotas deste
  // controller (criar, editar, publicar, gerar) tinha guarda de posse por
  // job_recrutador -- este módulo é mais antigo que o conceito de
  // job_recrutador (Fase 3a, antes da Fase 5a) e nunca passou pela rodada
  // de correção que os outros controllers já receberam. criar/gerar
  // recebem jobId direto no body -- checa posse direto. editar/publicar
  // recebem só :id do guide -- resolve interview_guide.id -> job_id (coluna
  // direta na tabela, sem join) antes de checar posse.
  private async exigirPosseDaVagaDoGuia(req: RequestWithAuthContext, guideId: string): Promise<void> {
    await this.tenantContext.run(req.tenantId, async (client) => {
      const result = await client.query<{ job_id: string }>(
        `SELECT job_id FROM interview_guide WHERE tenant_id = $1 AND id = $2`,
        [req.tenantId, guideId],
      );
      if (result.rows.length === 0) {
        throw new NotFoundException(`interview_guide ${guideId} não encontrado para o tenant`);
      }
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: result.rows[0].job_id,
        userId: req.userId,
        userRoles: req.userRoles,
      });
    });
  }

  @Post()
  @CerbosCheck('interview_guide', 'create')
  async criar(@Req() req: RequestWithAuthContext, @Body() dto: CriarRascunhoDto) {
    await this.tenantContext.run(req.tenantId, (client) =>
      this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: dto.jobId,
        userId: req.userId,
        userRoles: req.userRoles,
      }),
    );
    return this.tenantContext.run(req.tenantId, (client) =>
      this.guideService.criarRascunho(client, {
        tenantId: req.tenantId,
        jobId: dto.jobId,
        criadoPor: req.userId,
        competencias: dto.competencias,
      }),
    );
  }

  @Patch(':id')
  @CerbosCheck('interview_guide', 'update')
  async editar(@Req() req: RequestWithAuthContext, @Param('id') id: string, @Body() dto: EditarRascunhoDto) {
    await this.exigirPosseDaVagaDoGuia(req, id);
    try {
      await this.tenantContext.run(req.tenantId, (client) =>
        this.guideService.editarRascunho(client, req.tenantId, id, dto.competencias),
      );
      return { id };
    } catch (err) {
      // [Minor 2 da revisão final] id inexistente/de outro tenant vira 404
      // explícito -- antes editarRascunho() nem lançava, então o cliente
      // recebia 200 sem ter editado nada.
      if (err instanceof InterviewGuideNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }

  @Post(':id/publish')
  @CerbosCheck('interview_guide', 'publish')
  async publicar(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    await this.exigirPosseDaVagaDoGuia(req, id);
    try {
      return await this.tenantContext.run(req.tenantId, (client) =>
        this.guideService.publicar(client, req.tenantId, id, req.userId),
      );
    } catch (err) {
      // [Minor 1 da revisão final] As duas falhas de publicar() tinham
      // semânticas HTTP diferentes (guia não encontrado = 404; guia sem
      // competência = erro do cliente, 400) mas eram indistinguíveis antes
      // -- ambas viravam NotFoundException genérica.
      if (err instanceof InterviewGuideNotFoundError) throw new NotFoundException(err.message);
      if (err instanceof InterviewGuidePublishEmptyError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  @Post('generate')
  @CerbosCheck('interview_guide', 'create')
  async gerar(@Req() req: RequestWithAuthContext, @Body() dto: GerarRascunhoDto) {
    await this.tenantContext.run(req.tenantId, (client) =>
      this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: dto.jobId,
        userId: req.userId,
        userRoles: req.userRoles,
      }),
    );
    try {
      return await this.barsGenerationService.gerarRascunho({
        tenantId: req.tenantId,
        jobId: dto.jobId,
        tituloVaga: dto.tituloVaga,
        textoRequisicao: dto.textoRequisicao,
        criadoPor: req.userId,
        actorId: req.userId,
      });
    } catch (err) {
      // [Minor 3 da revisão final] Os dois fornecedores de LLM fora do ar
      // é uma indisponibilidade temporária do lado de fora (503), não um
      // erro do servidor (500) -- o cliente pode tentar de novo mais tarde
      // ou criar o roteiro manualmente via POST /v1/interview-guides.
      if (err instanceof ModelRouterUnavailableError) {
        throw new ServiceUnavailableException(
          'Geração por IA indisponível no momento -- tente novamente mais tarde ou crie o roteiro manualmente.',
        );
      }
      throw err;
    }
  }
}

import { Body, Controller, Param, Patch, Post, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { InterviewGuideService } from './interview-guide.service';
import { BarsGenerationService } from './bars-generation.service';

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
  @IsString() @IsNotEmpty() tituloVaga!: string;
  @IsString() @IsNotEmpty() textoRequisicao!: string;
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
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Post()
  @CerbosCheck('interview_guide', 'create')
  async criar(@Req() req: RequestWithAuthContext, @Body() dto: CriarRascunhoDto) {
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
    await this.tenantContext.run(req.tenantId, (client) =>
      this.guideService.editarRascunho(client, req.tenantId, id, dto.competencias),
    );
    return { id };
  }

  @Post(':id/publish')
  @CerbosCheck('interview_guide', 'publish')
  async publicar(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    try {
      return await this.tenantContext.run(req.tenantId, (client) =>
        this.guideService.publicar(client, req.tenantId, id, req.userId),
      );
    } catch (err) {
      throw new NotFoundException((err as Error).message);
    }
  }

  @Post('generate')
  @CerbosCheck('interview_guide', 'create')
  async gerar(@Req() req: RequestWithAuthContext, @Body() dto: GerarRascunhoDto) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.barsGenerationService.gerarRascunho(client, {
        tenantId: req.tenantId,
        jobId: dto.jobId,
        tituloVaga: dto.tituloVaga,
        textoRequisicao: dto.textoRequisicao,
        criadoPor: req.userId,
        actorId: req.userId,
      }),
    );
  }
}

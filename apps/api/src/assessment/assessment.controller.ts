import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';
import { AssessmentService } from './assessment.service';
import { ReportService } from './report/report.service';

class ConvidarDto {
  @IsUUID()
  applicationId!: string;

  @IsUUID()
  personId!: string;

  @IsUUID()
  instrumentVersionId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  nivelIntegridade?: number;
}

class ResponderDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  itemIds!: string[];

  @IsString()
  @IsNotEmpty()
  maisId!: string;

  @IsString()
  @IsNotEmpty()
  menosId!: string;

  @IsOptional()
  @IsInt()
  duracaoMs?: number;
}

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/assessments')
@UseGuards(CerbosGuard)
export class AssessmentController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly assessmentService: AssessmentService,
    private readonly reportService: ReportService,
    private readonly encryption: EnvelopeEncryptionService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Post()
  @CerbosCheck('assessment', 'create')
  async convidar(@Req() req: RequestWithAuthContext, @Body() dto: ConvidarDto) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.assessmentService.convidar(client, {
        tenantId: req.tenantId,
        applicationId: dto.applicationId,
        personId: dto.personId,
        instrumentVersionId: dto.instrumentVersionId,
        nivelIntegridade: dto.nivelIntegridade,
      }),
    );
  }

  @Post(':id/actions/start')
  @CerbosCheck('assessment', 'start')
  async iniciar(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    await this.tenantContext.run(req.tenantId, (client) => this.assessmentService.iniciar(client, id));
    return { id, status: 'iniciado' };
  }

  @Post(':id/blocks/:blockId/answer')
  @CerbosCheck('assessment', 'answer')
  async responder(
    @Req() req: RequestWithAuthContext,
    @Param('id') id: string,
    @Param('blockId') blockId: string,
    @Body() dto: ResponderDto,
  ) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.assessmentService.responderBloco(client, this.encryption, {
        assessmentApplicationId: id,
        blockId,
        itemIds: dto.itemIds,
        maisId: dto.maisId,
        menosId: dto.menosId,
        duracaoMs: dto.duracaoMs,
      }),
    );
  }

  @Post(':id/actions/complete')
  @CerbosCheck('assessment', 'complete')
  async concluir(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.assessmentService.concluir(client, this.encryption, id),
    );
  }

  @Get(':id/report')
  @CerbosCheck('assessment', 'read')
  async relatorio(@Req() req: RequestWithAuthContext, @Param('id') assessmentResultId: string) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.reportService.gerar(client, assessmentResultId),
    );
  }
}

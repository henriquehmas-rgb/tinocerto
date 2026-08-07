// apps/api/src/platform-api/platform-psych-report.controller.ts
import { Controller, Get, Param, Req, UseFilters, UseGuards } from '@nestjs/common';
import { ApiKeyGuard, RequestWithApiKeyContext } from './api-key.guard';
import { LaudoPsicologicoAccessGuard } from './laudo-psicologico-access.guard';
import { PlatformApiExceptionFilter } from './platform-api-exception.filter';
import { PsychReportService } from './psych-report.service';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';

// Path NOVO (kebab-case, v1/assessment-results -- doc 04 §1), distinto do
// path de sessão existente v1/assessments/results/:id/report (Trilho A,
// não tocado por esta fatia -- ver design spec, "Descobertas"). Zero
// colisão: nenhum outro controller usa este prefixo.
@Controller('v1/assessment-results')
@UseGuards(ApiKeyGuard, LaudoPsicologicoAccessGuard)
@UseFilters(PlatformApiExceptionFilter)
export class PlatformPsychReportController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly psychReportService: PsychReportService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get(':id/psych-report')
  async psychReport(@Req() req: RequestWithApiKeyContext, @Param('id') assessmentResultId: string) {
    const raw = await this.tenantContext.run(req.tenantId, (client) =>
      this.psychReportService.obterIntegra(client, assessmentResultId),
    );
    return {
      assessment_result_id: raw.assessmentResultId,
      theta: raw.theta,
      se_theta: raw.seTheta,
      escore_bruto: raw.escoreBruto,
      protocolo_confianca: raw.protocoloConfianca,
      calibracao_versao: raw.calibracaoVersao,
    };
  }
}

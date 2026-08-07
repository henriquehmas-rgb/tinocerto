import { ConflictException, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Pool } from 'pg';
import { CandidateAuthGuard } from './candidate-auth.guard';
import { TenantContext } from '../database/tenant-context';
import { CandidateEvaluationViewService } from '../hiring/candidate-evaluation-view.service';
import { DecisionService, DecisaoNaoEncontradaError, RevisaoJaSolicitadaError } from '../hiring/decision.service';

interface RequestWithCandidate extends Request {
  personId: string;
}

export interface CandidateApplicationSummaryView {
  applicationId: string;
  jobTitulo: string;
  etapaFunil: string;
  reprovadoEm: Date | null;
  atualizadoEm: Date;
}

@Controller('v1/candidate/applications')
@UseGuards(CandidateAuthGuard)
export class CandidateApplicationController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly pool: Pool,
    private readonly evaluationViewService: CandidateEvaluationViewService,
    private readonly decisionService: DecisionService,
  ) {
    this.tenantContext = new TenantContext(this.pool);
  }

  async listMyApplications(req: RequestWithCandidate): Promise<CandidateApplicationSummaryView[]> {
    const result = await this.pool.query<{
      application_id: string;
      job_titulo: string;
      etapa_funil: string;
      reprovado_em: Date | null;
      atualizado_em: Date;
    }>(
      `SELECT application_id, job_titulo, etapa_funil, reprovado_em, atualizado_em
       FROM candidate_application_summary
       WHERE person_id = $1
       ORDER BY atualizado_em DESC`,
      [req.personId],
    );
    return result.rows.map((row) => ({
      applicationId: row.application_id,
      jobTitulo: row.job_titulo,
      etapaFunil: row.etapa_funil,
      reprovadoEm: row.reprovado_em,
      atualizadoEm: row.atualizado_em,
    }));
  }

  @Get()
  async list(@Req() req: RequestWithCandidate) {
    return this.listMyApplications(req);
  }

  // candidate_application_summary é a única superfície global segura para
  // um candidato resolver "esta application_id é minha, e pertence a qual
  // tenant" sem tenant conhecido a priori -- ver migration
  // resume_0006__candidate_application_summary_tenant_id.sql. Zero linhas
  // -- candidatura de outra pessoa, ou inexistente -- sempre vira 404,
  // nunca 403 (não confirma nem nega a existência da candidatura para
  // outra pessoa).
  private async resolveOwnedApplicationTenant(personId: string, applicationId: string): Promise<string> {
    const result = await this.pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM candidate_application_summary WHERE application_id = $1 AND person_id = $2`,
      [applicationId, personId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException(`Candidatura ${applicationId} não encontrada`);
    }
    return result.rows[0].tenant_id;
  }

  @Get(':id/avaliacao')
  async avaliacao(@Req() req: RequestWithCandidate, @Param('id') id: string) {
    const tenantId = await this.resolveOwnedApplicationTenant(req.personId, id);
    return this.tenantContext.run(tenantId, (client) => this.evaluationViewService.build(client, tenantId, id));
  }

  @Post(':id/actions/solicitar-revisao')
  async solicitarRevisao(@Req() req: RequestWithCandidate, @Param('id') id: string) {
    const tenantId = await this.resolveOwnedApplicationTenant(req.personId, id);
    try {
      return await this.tenantContext.run(tenantId, async (client) => {
        const decisionRow = await client.query<{ id: string }>(
          `SELECT id FROM decision
            WHERE tenant_id = $1 AND application_id = $2 AND tipo = 'reprovacao'
            ORDER BY criado_em DESC LIMIT 1`,
          [tenantId, id],
        );
        if (decisionRow.rows.length === 0) {
          throw new NotFoundException(`Nenhuma decisão de reprovação encontrada para a candidatura ${id}`);
        }
        return this.decisionService.solicitarRevisao(client, tenantId, decisionRow.rows[0].id);
      });
    } catch (err) {
      if (err instanceof RevisaoJaSolicitadaError) {
        throw new ConflictException(err.message);
      }
      if (err instanceof DecisaoNaoEncontradaError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}

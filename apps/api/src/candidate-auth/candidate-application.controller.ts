import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Pool } from 'pg';
import { CandidateAuthGuard } from './candidate-auth.guard';

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
  constructor(private readonly pool: Pool) {}

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
}

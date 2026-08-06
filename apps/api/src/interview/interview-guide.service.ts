import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CompetencyService, CompetenciaComAncorasInput } from './competency.service';

export interface InterviewGuideCriarInput {
  tenantId: string;
  jobId: string;
  criadoPor?: string;
  competencias: CompetenciaComAncorasInput[];
}

@Injectable()
export class InterviewGuideService {
  constructor(private readonly competencyService: CompetencyService) {}

  async criarRascunho(client: PoolClient, input: InterviewGuideCriarInput): Promise<{ id: string }> {
    const snapshot = await this.competencyService.resolverParaSnapshot(client, input.tenantId, input.competencias);
    const result = await client.query<{ id: string }>(
      `INSERT INTO interview_guide (tenant_id, job_id, status, competencias_rascunho, criado_por)
       VALUES ($1, $2, 'rascunho', $3, $4) RETURNING id`,
      [input.tenantId, input.jobId, JSON.stringify(snapshot), input.criadoPor ?? null],
    );
    return { id: result.rows[0].id };
  }

  async editarRascunho(
    client: PoolClient,
    tenantId: string,
    guideId: string,
    competencias: CompetenciaComAncorasInput[],
  ): Promise<void> {
    const snapshot = await this.competencyService.resolverParaSnapshot(client, tenantId, competencias);
    await client.query(
      `UPDATE interview_guide SET competencias_rascunho = $3, atualizado_em = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, guideId, JSON.stringify(snapshot)],
    );
  }

  async publicar(
    client: PoolClient,
    tenantId: string,
    guideId: string,
    publicadoPor?: string,
  ): Promise<{ id: string; versao: number }> {
    const guide = await client.query<{ competencias_rascunho: unknown[] }>(
      `SELECT competencias_rascunho FROM interview_guide WHERE tenant_id = $1 AND id = $2`,
      [tenantId, guideId],
    );
    if (guide.rows.length === 0) {
      throw new Error(`interview_guide ${guideId} não encontrado para o tenant`);
    }
    const competencias = guide.rows[0].competencias_rascunho;
    if (!Array.isArray(competencias) || competencias.length === 0) {
      throw new Error('Não é possível publicar um roteiro sem nenhuma competência');
    }

    const ultimaVersao = await client.query<{ versao: number }>(
      `SELECT COALESCE(MAX(versao), 0) AS versao FROM interview_guide_version WHERE tenant_id = $1 AND interview_guide_id = $2`,
      [tenantId, guideId],
    );
    const novaVersao = ultimaVersao.rows[0].versao + 1;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO interview_guide_version (tenant_id, interview_guide_id, versao, competencias_snapshot, publicado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, guideId, novaVersao, JSON.stringify(competencias), publicadoPor ?? null],
    );

    await client.query(
      `UPDATE interview_guide SET status = 'publicado', atualizado_em = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, guideId],
    );

    return { id: inserted.rows[0].id, versao: novaVersao };
  }
}

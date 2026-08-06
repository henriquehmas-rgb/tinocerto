import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface DeclararAutodeclaracaoInput {
  tenantId: string;
  personId: string;
  genero?: string;
  racaCor?: string;
  faixaEtaria?: string;
  pcd?: boolean;
  consentId: string;
}

@Injectable()
export class DemographicSelfReportService {
  async declarar(client: PoolClient, input: DeclararAutodeclaracaoInput): Promise<void> {
    const consent = await client.query<{
      finalidade: string;
      person_id: string;
      tenant_id: string | null;
      revoked_at: Date | null;
    }>(`SELECT finalidade, person_id, tenant_id, revoked_at FROM consent WHERE id = $1`, [input.consentId]);

    if (consent.rows.length === 0) {
      throw new Error(`Consentimento ${input.consentId} não encontrado`);
    }
    const c = consent.rows[0];
    if (c.finalidade !== 'autodeclaracao_diversidade') {
      throw new Error(`Consentimento ${input.consentId} não é de autodeclaração de diversidade`);
    }
    if (c.person_id !== input.personId || c.tenant_id !== input.tenantId) {
      throw new Error(`Consentimento ${input.consentId} não pertence a este candidato/tenant`);
    }
    if (c.revoked_at !== null) {
      throw new Error(`Consentimento ${input.consentId} foi revogado`);
    }

    await client.query(
      `INSERT INTO demographic_self_report (tenant_id, person_id, genero, raca_cor, faixa_etaria, pcd, consent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, person_id) DO UPDATE
       SET genero = $3, raca_cor = $4, faixa_etaria = $5, pcd = $6, consent_id = $7, declarado_em = now()`,
      [
        input.tenantId,
        input.personId,
        input.genero ?? null,
        input.racaCor ?? null,
        input.faixaEtaria ?? null,
        input.pcd ?? null,
        input.consentId,
      ],
    );
  }
}

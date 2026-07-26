import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface AddCustomFieldInput {
  tenantId: string;
  jobId: string;
  label: string;
  tipoCampo?: string;
  faseColeta?: 'inscricao' | 'admissao';
  baseLegal?: string;
}

export interface JobCustomFieldRecord {
  id: string;
  label: string;
  tipoCampo: string;
  faseColeta: 'inscricao' | 'admissao';
  baseLegal: string | null;
}

@Injectable()
export class JobCustomFieldService {
  async addField(client: PoolClient, input: AddCustomFieldInput): Promise<{ id: string }> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO job_custom_field (tenant_id, job_id, label, tipo_campo, fase_coleta, base_legal)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        input.tenantId,
        input.jobId,
        input.label,
        input.tipoCampo ?? 'texto_livre',
        input.faseColeta ?? 'inscricao',
        input.baseLegal ?? null,
      ],
    );
    return { id: result.rows[0].id };
  }

  async listByJob(client: PoolClient, jobId: string): Promise<JobCustomFieldRecord[]> {
    const result = await client.query<{
      id: string;
      label: string;
      tipo_campo: string;
      fase_coleta: 'inscricao' | 'admissao';
      base_legal: string | null;
    }>(`SELECT id, label, tipo_campo, fase_coleta, base_legal FROM job_custom_field WHERE job_id = $1`, [jobId]);
    return result.rows.map((row) => ({
      id: row.id,
      label: row.label,
      tipoCampo: row.tipo_campo,
      faseColeta: row.fase_coleta,
      baseLegal: row.base_legal,
    }));
  }
}

import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { classifyHardBlockedCategories } from './compliance/hard-blocked-category-linter';

export interface AddCustomFieldInput {
  tenantId: string;
  jobId: string;
  label: string;
  tipoCampo?: string;
  faseColeta?: 'inscricao' | 'admissao';
  baseLegal?: string;
  justificativa?: string;
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
  private static readonly NATUREZAS_ELEGIVEIS_ANTECEDENTES = [
    'seguranca_patrimonial',
    'fe_publica',
    'manuseio_valores',
    'responsavel_por_menor',
  ];

  async addField(client: PoolClient, input: AddCustomFieldInput): Promise<{ id: string }> {
    const hardBlocked = classifyHardBlockedCategories(input.label);
    const isOnlyCriminalBackground = hardBlocked.length > 0 && hardBlocked.every((c) => c === 'antecedentes_criminais');

    if (hardBlocked.length > 0 && !isOnlyCriminalBackground) {
      throw new Error(
        `Campo "${input.label}" é bloqueio duro (${hardBlocked.join(', ')}) e não pode ser adicionado ao formulário sob nenhuma circunstância — Lei 9.029/95`,
      );
    }

    if (isOnlyCriminalBackground) {
      const job = await client.query<{ natureza_cargo: string | null }>(
        `SELECT natureza_cargo FROM job WHERE id = $1`,
        [input.jobId],
      );
      const natureza = job.rows[0]?.natureza_cargo ?? null;
      if (!natureza || !JobCustomFieldService.NATUREZAS_ELEGIVEIS_ANTECEDENTES.includes(natureza)) {
        throw new Error(
          `Campo de antecedentes criminais só é permitido em vagas com natureza de cargo em (${JobCustomFieldService.NATUREZAS_ELEGIVEIS_ANTECEDENTES.join(', ')})`,
        );
      }
      if (!input.justificativa) {
        throw new Error('Campo de antecedentes criminais exige justificativa registrada para fins de auditoria');
      }
    }

    const result = await client.query<{ id: string }>(
      `INSERT INTO job_custom_field (tenant_id, job_id, label, tipo_campo, fase_coleta, base_legal, justificativa)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        input.tenantId,
        input.jobId,
        input.label,
        input.tipoCampo ?? 'texto_livre',
        input.faseColeta ?? 'inscricao',
        input.baseLegal ?? null,
        input.justificativa ?? null,
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

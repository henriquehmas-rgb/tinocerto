import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { generateLiaTemplate } from './compliance/lia-template';

export interface CreateLiaInput {
  tenantId: string;
  jobCustomFieldId: string;
  campoLabel: string;
  finalidade: string;
}

@Injectable()
export class LiaDocumentService {
  async createForField(client: PoolClient, input: CreateLiaInput): Promise<{ id: string }> {
    const template = generateLiaTemplate({ campoLabel: input.campoLabel, finalidade: input.finalidade });
    const result = await client.query<{ id: string }>(
      `INSERT INTO lia_document (tenant_id, job_custom_field_id, finalidade, teste_necessidade, teste_proporcionalidade, salvaguardas)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        input.tenantId,
        input.jobCustomFieldId,
        input.finalidade,
        template.testeNecessidade,
        template.testeProporcionalidade,
        template.salvaguardas,
      ],
    );
    return { id: result.rows[0].id };
  }
}

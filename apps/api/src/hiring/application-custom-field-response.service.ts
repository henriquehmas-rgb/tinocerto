import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';

export interface RecordResponseInput {
  tenantId: string;
  applicationId: string;
  jobCustomFieldId: string;
  valor: string;
}

@Injectable()
export class ApplicationCustomFieldResponseService {
  async recordResponse(
    client: PoolClient,
    encryption: EnvelopeEncryptionService,
    input: RecordResponseInput,
  ): Promise<{ id: string }> {
    const field = await client.query<{ fase_coleta: 'inscricao' | 'admissao' }>(
      `SELECT fase_coleta FROM job_custom_field WHERE id = $1`,
      [input.jobCustomFieldId],
    );
    if (field.rows.length === 0) {
      throw new Error(`Campo customizado ${input.jobCustomFieldId} não encontrado`);
    }

    if (field.rows[0].fase_coleta === 'admissao') {
      const approved = await client.query(
        `SELECT 1 FROM decision WHERE application_id = $1 AND tipo = 'aprovacao' LIMIT 1`,
        [input.applicationId],
      );
      if (approved.rows.length === 0) {
        throw new Error(
          `Campo é de fase de admissão e só pode ser respondido após decisão de aprovação da candidatura — coleta faseada (LGPD minimização)`,
        );
      }
    }

    const encrypted = encryption.encrypt(input.valor);
    const result = await client.query<{ id: string }>(
      `INSERT INTO application_custom_field_response (tenant_id, application_id, job_custom_field_id, valor_criptografado)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.tenantId, input.applicationId, input.jobCustomFieldId, JSON.stringify(encrypted)],
    );
    return { id: result.rows[0].id };
  }
}

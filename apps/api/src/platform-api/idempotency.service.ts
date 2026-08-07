import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';

const RETENTION_MS = 24 * 60 * 60 * 1000;

export type IdempotencyCheckResult =
  | { status: 'novo' }
  | { status: 'repetido'; respostaSnapshot: unknown }
  | { status: 'conflito' };

export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

@Injectable()
export class IdempotencyService {
  async checkOrReserve(
    client: PoolClient,
    input: { tenantId: string; chave: string; hashDaRequisicao: string },
  ): Promise<IdempotencyCheckResult> {
    const existing = await client.query<{ hash_da_requisicao: string; resposta_snapshot: unknown }>(
      `SELECT hash_da_requisicao, resposta_snapshot FROM idempotency_key
        WHERE tenant_id = $1 AND chave = $2 AND expira_em > now()`,
      [input.tenantId, input.chave],
    );
    if (existing.rows.length === 0) {
      return { status: 'novo' };
    }
    const row = existing.rows[0];
    if (row.hash_da_requisicao !== input.hashDaRequisicao) {
      return { status: 'conflito' };
    }
    return { status: 'repetido', respostaSnapshot: row.resposta_snapshot };
  }

  async store(
    client: PoolClient,
    input: { tenantId: string; chave: string; hashDaRequisicao: string; respostaSnapshot: unknown },
  ): Promise<void> {
    const expiraEm = new Date(Date.now() + RETENTION_MS);
    await client.query(
      `INSERT INTO idempotency_key (tenant_id, chave, hash_da_requisicao, resposta_snapshot, expira_em)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, chave) DO UPDATE
         SET hash_da_requisicao = EXCLUDED.hash_da_requisicao,
             resposta_snapshot  = EXCLUDED.resposta_snapshot,
             expira_em          = EXCLUDED.expira_em,
             criado_em          = now()`,
      [input.tenantId, input.chave, input.hashDaRequisicao, JSON.stringify(input.respostaSnapshot), expiraEm],
    );
  }
}

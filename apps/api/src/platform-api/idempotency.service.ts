import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';

const RETENTION_MS = 24 * 60 * 60 * 1000;

export type IdempotencyCheckResult =
  | { status: 'novo' }
  | { status: 'em-andamento' }
  | { status: 'repetido'; respostaSnapshot: unknown }
  | { status: 'conflito' };

export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

@Injectable()
export class IdempotencyService {
  // Reserva atômica: o INSERT ... ON CONFLICT DO UPDATE ... WHERE é uma
  // única ida ao Postgres, e o UNIQUE (tenant_id, chave) faz a segunda
  // requisição concorrente esperar na trava de linha da primeira até ela
  // comitar/abortar -- não existe mais janela entre "verificar" e "gravar"
  // como havia com o SELECT solto de antes. Quando a linha já existe e
  // ainda não está expirada, a cláusula WHERE reprova o DO UPDATE, nada é
  // retornado, e caímos no SELECT de baixo só para decidir qual dos três
  // estados finais (em-andamento / repetido / conflito) reportar.
  async checkOrReserve(
    client: PoolClient,
    input: { tenantId: string; chave: string; hashDaRequisicao: string },
  ): Promise<IdempotencyCheckResult> {
    const expiraEm = new Date(Date.now() + RETENTION_MS);
    const reserved = await client.query<{ id: string }>(
      `INSERT INTO idempotency_key (tenant_id, chave, hash_da_requisicao, resposta_snapshot, expira_em, pronto)
       VALUES ($1, $2, $3, 'null'::jsonb, $4, false)
       ON CONFLICT (tenant_id, chave) DO UPDATE
         SET hash_da_requisicao = EXCLUDED.hash_da_requisicao,
             resposta_snapshot  = EXCLUDED.resposta_snapshot,
             expira_em          = EXCLUDED.expira_em,
             pronto             = false,
             criado_em          = now()
         WHERE idempotency_key.expira_em <= now()
       RETURNING id`,
      [input.tenantId, input.chave, input.hashDaRequisicao, expiraEm],
    );
    if (reserved.rows.length > 0) {
      // Linha inserida agora, ou linha antiga expirada foi reaproveitada
      // como se fosse nova -- em ambos os casos a reserva é nossa.
      return { status: 'novo' };
    }

    const existing = await client.query<{
      hash_da_requisicao: string;
      resposta_snapshot: unknown;
      pronto: boolean;
    }>(
      `SELECT hash_da_requisicao, resposta_snapshot, pronto FROM idempotency_key
        WHERE tenant_id = $1 AND chave = $2`,
      [input.tenantId, input.chave],
    );
    // A linha existe (acabamos de perder a corrida do INSERT); se sumiu
    // entre as duas queries é uma condição de corrida patológica que não
    // deveria acontecer em uso normal -- trata como novo já que não há
    // reserva concorrente detectável.
    if (existing.rows.length === 0) {
      return { status: 'novo' };
    }
    const row = existing.rows[0];
    if (!row.pronto) {
      return { status: 'em-andamento' };
    }
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
    // Continua um upsert (não um UPDATE puro): o fluxo normal via
    // IdempotencyInterceptor sempre chama checkOrReserve() antes, então a
    // linha já existe reservada com pronto=false -- mas manter o upsert
    // aqui evita acoplar store() a essa ordem específica de chamadas (é o
    // mesmo contrato de antes da correção, só que agora sempre grava
    // pronto=true).
    await client.query(
      `INSERT INTO idempotency_key (tenant_id, chave, hash_da_requisicao, resposta_snapshot, expira_em, pronto)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (tenant_id, chave) DO UPDATE
         SET hash_da_requisicao = EXCLUDED.hash_da_requisicao,
             resposta_snapshot  = EXCLUDED.resposta_snapshot,
             expira_em          = EXCLUDED.expira_em,
             pronto             = true,
             criado_em          = now()`,
      [input.tenantId, input.chave, input.hashDaRequisicao, JSON.stringify(input.respostaSnapshot), expiraEm],
    );
  }
}

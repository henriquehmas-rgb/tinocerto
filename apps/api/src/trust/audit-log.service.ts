import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PoolClient } from 'pg';

export interface AuditLogEntryInput {
  tenantId: string;
  actorId?: string;
  actorType: string;
  onBehalfOf?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  fieldsRead?: string[];
  ip?: string;
  userAgent?: string;
  requestId?: string;
  occurredAt: Date;
}

/**
 * Computa o hash de uma entrada da cadeia de auditoria. Extraida como
 * funcao pura (exportada) para que os testes possam recomputar o hash com
 * a EXATA mesma formula usada por `append()`, sem duplicar a logica.
 *
 * Cobre dois achados da revisao adversarial da Task 13:
 *
 * - [Important] O hash cobria so 8 dos 14 campos gravados na linha,
 *   deixando de fora `on_behalf_of`, `fields_read`, `ip`, `user_agent`,
 *   `request_id` e o proprio `id` -- justamente a carga probatoria LGPD
 *   (quem leu quais campos, em nome de quem). Uma adulteracao direta no
 *   banco desses campos (ex.: por quem tem acesso privilegiado ao
 *   Postgres, fora do alcance do REVOKE de app_runtime) passava
 *   despercebida pela cadeia. Agora TODOS os campos de conteudo entram no
 *   hash, inclusive `id` e `chainSeq` (a posicao da entrada na cadeia).
 *
 * - [Important] A concatenacao `[...].join('|')` permitia que um valor
 *   contendo '|' (em `action`, `resourceType` ou `actorType` -- todos
 *   `text` livre, sem CHECK/enum) deslocasse a fronteira entre campos e
 *   fizesse duas entradas logicamente distintas produzirem o mesmo hash
 *   (colisao demonstrada com action='read|export' + resourceType=
 *   'laudo_psicologico' vs action='read' + resourceType=
 *   'export|laudo_psicologico'). JSON.stringify escapa aspas/barras e
 *   serializa cada campo em uma posicao de chave fixa, sem fronteira
 *   ambigua. `?? null` (em vez do `?? ''` anterior) elimina a ambiguidade
 *   de sentinela entre "campo ausente" e "campo vazio" (antes,
 *   `actorId: undefined` e `actorId: ''` produziam o mesmo hash).
 */
export function computeEntryHash(
  prevHash: string | null,
  id: string,
  chainSeq: bigint,
  entry: AuditLogEntryInput,
): string {
  const canonical = JSON.stringify({
    prevHash,
    chainSeq: chainSeq.toString(),
    id,
    tenantId: entry.tenantId,
    actorId: entry.actorId ?? null,
    actorType: entry.actorType,
    onBehalfOf: entry.onBehalfOf ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    fieldsRead: entry.fieldsRead ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    requestId: entry.requestId ?? null,
    occurredAt: entry.occurredAt.toISOString(),
  });

  return createHash('sha256').update(canonical).digest('hex');
}

@Injectable()
export class AuditLogService {
  async append(client: PoolClient, entry: AuditLogEntryInput): Promise<void> {
    // [Critical] Serializa por tenant no proprio banco. Antes desta
    // correcao, `append()` fazia um SELECT do ultimo hash e um INSERT em
    // duas queries separadas dentro da mesma transacao READ COMMITTED, sem
    // lock nem constraint que serializasse -- transacoes concorrentes do
    // mesmo tenant liam o mesmo "ultimo hash" antes de qualquer commit e
    // todas gravavam o mesmo prev_hash (reproduzido: 7 de 10 escritas
    // concorrentes colidindo no mesmo predecessor, 8 pontas de cadeia
    // onde deveria haver exatamente 1).
    //
    // pg_advisory_xact_lock, adquirido ANTES do SELECT do predecessor,
    // serializa os appends do mesmo tenant sem exigir uma linha para
    // travar (o tenant pode ainda nao ter nenhuma entrada na tabela) e e
    // liberado automaticamente no COMMIT/ROLLBACK feito por
    // TenantContext.run() -- sem risco de lock preso por conexao que
    // nunca libera. hashtext(tenantId) converte o uuid em uma chave
    // bigint; colisao de hashtext entre dois tenants diferentes so custa
    // paralelismo (serializa tenants que nao precisavam), nunca
    // corretude.
    //
    // Escolha de design deliberadamente conservadora: lock exclusivo por
    // tenant, mesmo custando serializacao total dos appends de um mesmo
    // tenant. E o requisito mais forte que garante corretude com certeza;
    // um esquema mais permissivo (ex.: retry otimista via a constraint
    // UNIQUE da migration trust_0002) teria mais throughput mas exigiria
    // logica de retry no chamador -- nao ha indicacao de que o volume de
    // auditoria por tenant justifique essa complexidade adicional agora.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [entry.tenantId]);

    // [Important] Predecessor e posicao na cadeia sao escolhidos por
    // chain_seq (coluna controlada pelo banco via UNIQUE(tenant_id,
    // chain_seq), ver migration trust_0002), nao mais por occurred_at.
    // occurred_at e fornecido pelo chamador -- e dado de negocio (quando o
    // evento aconteceu), nao gerado pelo banco, e nao e unico nem
    // monotonico. Um evento fora de ordem (ex.: consumidor de outbox
    // reprocessando um evento atrasado, cenario real da Task 14) fazia
    // `ORDER BY occurred_at` escolher o predecessor errado e quebrar a
    // cadeia sem nenhuma adulteracao real ter ocorrido. chain_seq =
    // ultimo + 1 e atribuido aqui, sob o advisory lock acima, entao e
    // estritamente sequencial por tenant e reflete a ordem real de
    // insercao, nao a ordem de occurred_at.
    const last = await client.query<{ hash: string; chain_seq: string }>(
      `SELECT hash, chain_seq FROM audit_log_entry WHERE tenant_id = $1 ORDER BY chain_seq DESC LIMIT 1`,
      [entry.tenantId],
    );
    const prevHash = last.rows[0]?.hash ?? null;
    const chainSeq = last.rows[0] ? BigInt(last.rows[0].chain_seq) + 1n : 1n;

    // id gerado na aplicacao (em vez de deixar para o DEFAULT
    // gen_random_uuid() da coluna) para que o proprio id entre no hash --
    // ver comentario de computeEntryHash acima.
    const id = randomUUID();
    const hash = computeEntryHash(prevHash, id, chainSeq, entry);

    await client.query(
      `INSERT INTO audit_log_entry
         (id, tenant_id, actor_id, actor_type, on_behalf_of, action, resource_type, resource_id,
          fields_read, ip, user_agent, request_id, occurred_at, prev_hash, hash, chain_seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        id,
        entry.tenantId,
        entry.actorId ?? null,
        entry.actorType,
        entry.onBehalfOf ?? null,
        entry.action,
        entry.resourceType,
        entry.resourceId ?? null,
        entry.fieldsRead ?? null,
        entry.ip ?? null,
        entry.userAgent ?? null,
        entry.requestId ?? null,
        entry.occurredAt,
        prevHash,
        hash,
        chainSeq.toString(),
      ],
    );
  }
}

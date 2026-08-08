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
 * - [Important] A concatenacao `[...].join("|")` permitia que um valor
 *   contendo "|" (em `action`, `resourceType` ou `actorType` -- todos
 *   `text` livre, sem CHECK/enum) deslocasse a fronteira entre campos e
 *   fizesse duas entradas logicamente distintas produzirem o mesmo hash
 *   (colisao demonstrada com action="read|export" + resourceType=
 *   "laudo_psicologico" vs action="read" + resourceType=
 *   "export|laudo_psicologico"). JSON.stringify escapa aspas/barras e
 *   serializa cada campo em uma posicao de chave fixa, sem fronteira
 *   ambigua. `?? null` (em vez do `?? ""` anterior) elimina a ambiguidade
 *   de sentinela entre "campo ausente" e "campo vazio" (antes,
 *   `actorId: undefined` e `actorId: ""` produziam o mesmo hash).
 *
 * IMPORTANTE (4a rodada): esta funcao NAO normaliza nada -- ela serializa
 * exatamente os campos do `entry` recebido. Para os campos tipados
 * (`tenantId`, `actorId`, `onBehalfOf`, `resourceId`, `ip` -- colunas
 * `uuid`/`inet` no Postgres), quem CHAMA esta funcao e responsavel por
 * garantir que `entry` ja contenha a forma CANONICA que o Postgres vai
 * gravar (ver `append()` abaixo). Recomputar o hash a partir de valores
 * crus e nao-canonicos e exatamente o bug que a 4a rodada corrigiu.
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
    // occurredAt e canonico por HIPOTESE, nao por construcao como os
    // campos uuid/inet acima (que passam pela query de cast do Postgres em
    // append() antes de chegar aqui): dependemos do round-trip Date -> ISO
    // string -> timestamptz -> Date bater de volta sem perda. Hoje bate
    // (Date e Number em ms, timestamptz do Postgres tem precisao de
    // microssegundo, nao ha perda). Se um dia entrarem timestamps fora da
    // faixa seguro de Date ou uma origem que forneca precisao sub-ms, esta
    // premissa precisa ser revisitada (ou canonizada pelo Postgres como os
    // demais campos tipados).
    occurredAt: entry.occurredAt.toISOString(),
  });

  return createHash('sha256').update(canonical).digest('hex');
}

@Injectable()
export class AuditLogService {
  async append(client: PoolClient, entry: AuditLogEntryInput): Promise<void> {
    // [Important, 4a rodada] tenant_id, actor_id, on_behalf_of,
    // resource_id (uuid) e ip (inet) sao colunas TIPADAS, e o Postgres
    // NORMALIZA o valor na gravacao (uuid maiusculo vira minusculo, inet
    // IPv6 nao-comprimido vira comprimido, etc). Se hasheassemos a string
    // CRUA recebida do chamador, um verificador externo que releia a LINHA
    // DO BANCO (e tudo que um auditor tem) recomputaria o hash a partir do
    // valor CANONICO e divergiria do hash gravado em dados 100% honestos --
    // falso positivo de adulteracao. Pelo mesmo motivo, a CHAVE do advisory
    // lock abaixo (achado [Critical] da 1a rodada) tambem precisa ser
    // canonica: dois requests do mesmo tenant chegando com case diferente
    // no uuid (plausivel -- tenant-transaction.middleware.ts extrai
    // tenantId do payload do JWT de staff verificado, Task 8, sem
    // normalizar) pegariam chaves de
    // hashtext() DIFERENTES, e a serializacao que deveria prevenir a
    // bifurcacao da cadeia simplesmente nao aconteceria para esse par.
    //
    // Correcao: deixar o PROPRIO Postgres canonicalizar, em vez de
    // reimplementar as regras de normalizacao de uuid/inet em JS (facil de
    // errar sutilmente -- ex.: compressao de IPv6 -- e criar falsa sensacao
    // de correcao). Esta query so faz CAST (nao le nem grava nenhuma
    // linha), roda no mesmo `client`/transacao do append, mas ANTES do
    // advisory lock -- nao participa de nenhuma condicao de corrida.
    // `$N::uuid::text` com parametro NULL devolve NULL (nao a string
    // "null"), entao campos opcionais ausentes permanecem ausentes.
    //
    // ATENCAO -- pegadinha real do Postgres verificada empiricamente antes
    // de escrever esta query: `inet` tem uma funcao de CAST para text
    // (`pg_cast` -> `text(inet)`) que e DIFERENTE da funcao de saida do
    // proprio tipo (`inet_out`, usada quando um client faz um SELECT comum
    // da coluna). `'203.0.113.5'::inet::text` devolve
    // "203.0.113.5/32" (a funcao de CAST sempre mostra a mascara), enquanto
    // um SELECT direto da coluna (o que um verificador externo realmente
    // le) devolve "203.0.113.5" (inet_out omite /32 e /128, a mascara
    // "hospedeiro inteiro"). Por isso o campo `ip` abaixo NAO usa `::text`
    // -- fica como `inet`, e o driver `pg` (que nao tem parser proprio para
    // o OID de `inet`) devolve a string tal como veio do wire, ou seja, na
    // MESMA forma de `inet_out` que um SELECT normal da coluna produziria.
    // uuid nao tem essa pegadinha (`uuid::text` e a saida natural do tipo
    // uuid sao identicas -- verificado tambem), entao os campos uuid
    // mantem `::text` sem problema.
    const canonical = await client.query<{
      tenant_id: string;
      actor_id: string | null;
      on_behalf_of: string | null;
      resource_id: string | null;
      ip: string | null;
    }>(
      `SELECT
         $1::uuid::text AS tenant_id,
         $2::uuid::text AS actor_id,
         $3::uuid::text AS on_behalf_of,
         $4::uuid::text AS resource_id,
         $5::inet AS ip`,
      [
        entry.tenantId,
        entry.actorId ?? null,
        entry.onBehalfOf ?? null,
        entry.resourceId ?? null,
        entry.ip ?? null,
      ],
    );
    const c = canonical.rows[0];

    // `entry` com os campos tipados substituidos pela forma CANONICA --
    // usado daqui pra frente para (a) a chave do advisory lock, (b) o
    // objeto que vira o hash, e (c) os parametros do INSERT final, para
    // que o valor hasheado seja EXATAMENTE o valor gravado. Campos NAO
    // tipados (actorType, action, resourceType, fieldsRead, userAgent,
    // requestId) sao text/text[] livres, sem normalizacao do Postgres, e
    // permanecem como o chamador enviou.
    const canonicalEntry: AuditLogEntryInput = {
      ...entry,
      tenantId: c.tenant_id,
      actorId: c.actor_id ?? undefined,
      onBehalfOf: c.on_behalf_of ?? undefined,
      resourceId: c.resource_id ?? undefined,
      ip: c.ip ?? undefined,
    };

    // [Critical, 1a rodada] Serializa por tenant no proprio banco. Antes
    // desta correcao, `append()` fazia um SELECT do ultimo hash e um
    // INSERT em duas queries separadas dentro da mesma transacao READ
    // COMMITTED, sem lock nem constraint que serializasse -- transacoes
    // concorrentes do mesmo tenant liam o mesmo "ultimo hash" antes de
    // qualquer commit e todas gravavam o mesmo prev_hash (reproduzido: 7
    // de 10 escritas concorrentes colidindo no mesmo predecessor, 8 pontas
    // de cadeia onde deveria haver exatamente 1).
    //
    // pg_advisory_xact_lock, adquirido ANTES do SELECT do predecessor,
    // serializa os appends do mesmo tenant sem exigir uma linha para
    // travar (o tenant pode ainda nao ter nenhuma entrada na tabela) e e
    // liberado automaticamente no COMMIT/ROLLBACK feito por
    // TenantContext.run() -- sem risco de lock preso por conexao que
    // nunca libera. hashtext(tenantId) converte o uuid em uma chave
    // bigint; colisao de hashtext entre dois tenants diferentes so custa
    // paralelismo (serializa tenants que nao precisavam), nunca
    // corretude. A chave usa canonicalEntry.tenantId (ver comentario
    // acima) para que o MESMO tenant sempre produza a MESMA chave,
    // independente do case com que o uuid chegou nesta chamada.
    //
    // Escolha de design deliberadamente conservadora: lock exclusivo por
    // tenant, mesmo custando serializacao total dos appends de um mesmo
    // tenant. E o requisito mais forte que garante corretude com certeza;
    // um esquema mais permissivo (ex.: retry otimista via a constraint
    // UNIQUE da migration trust_0002) teria mais throughput mas exigiria
    // logica de retry no chamador -- nao ha indicacao de que o volume de
    // auditoria por tenant justifique essa complexidade adicional agora.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [canonicalEntry.tenantId]);

    // [Important, 1a rodada] Predecessor e posicao na cadeia sao
    // escolhidos por chain_seq (coluna controlada pelo banco via
    // UNIQUE(tenant_id, chain_seq), ver migration trust_0002), nao mais
    // por occurred_at. occurred_at e fornecido pelo chamador -- e dado de
    // negocio (quando o evento aconteceu), nao gerado pelo banco, e nao e
    // unico nem monotonico. Um evento fora de ordem (ex.: consumidor de
    // outbox reprocessando um evento atrasado, cenario real da Task 14)
    // fazia `ORDER BY occurred_at` escolher o predecessor errado e quebrar
    // a cadeia sem nenhuma adulteracao real ter ocorrido. chain_seq =
    // ultimo + 1 e atribuido aqui, sob o advisory lock acima, entao e
    // estritamente sequencial por tenant e reflete a ordem real de
    // insercao, nao a ordem de occurred_at.
    const last = await client.query<{ hash: string; chain_seq: string }>(
      `SELECT hash, chain_seq FROM audit_log_entry WHERE tenant_id = $1 ORDER BY chain_seq DESC LIMIT 1`,
      [canonicalEntry.tenantId],
    );
    const prevHash = last.rows[0]?.hash ?? null;
    const chainSeq = last.rows[0] ? BigInt(last.rows[0].chain_seq) + 1n : 1n;

    // id gerado na aplicacao (em vez de deixar para o DEFAULT
    // gen_random_uuid() da coluna) para que o proprio id entre no hash --
    // ver comentario de computeEntryHash acima.
    const id = randomUUID();
    const hash = computeEntryHash(prevHash, id, chainSeq, canonicalEntry);

    await client.query(
      `INSERT INTO audit_log_entry
         (id, tenant_id, actor_id, actor_type, on_behalf_of, action, resource_type, resource_id,
          fields_read, ip, user_agent, request_id, occurred_at, prev_hash, hash, chain_seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        id,
        canonicalEntry.tenantId,
        canonicalEntry.actorId ?? null,
        canonicalEntry.actorType,
        canonicalEntry.onBehalfOf ?? null,
        canonicalEntry.action,
        canonicalEntry.resourceType,
        canonicalEntry.resourceId ?? null,
        canonicalEntry.fieldsRead ?? null,
        canonicalEntry.ip ?? null,
        canonicalEntry.userAgent ?? null,
        canonicalEntry.requestId ?? null,
        canonicalEntry.occurredAt,
        prevHash,
        hash,
        chainSeq.toString(),
      ],
    );
  }
}

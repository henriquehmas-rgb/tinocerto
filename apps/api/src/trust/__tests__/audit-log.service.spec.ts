import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AuditLogService, AuditLogEntryInput, computeEntryHash } from '../audit-log.service';

describe('AuditLogService.append — hash chain', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const pool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  // audit_log_entry.actor_id / resource_id são `uuid` na migration — usamos
  // literais em formato UUID válido aqui (o brief original usava 'user-1' /
  // 'laudo-1', que o Postgres rejeita com "invalid input syntax for type
  // uuid"; corrigido mantendo o mesmo ator/recurso reaproveitado nos dois
  // registros, igual à intenção original do teste).
  const actorId = '11111111-1111-1111-1111-111111111111';
  const resourceId = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    // CNPJ '00000000000009' (usado antes aqui) colidia com o mesmo valor em
    // outbox-publisher.service.spec.ts (achado Minor recorrente da revisão
    // — tenant.cnpj é UNIQUE, e os dois specs podem rodar em paralelo como
    // workers distintos do Jest). Trocado para um valor não usado em
    // nenhum outro spec do repositório.
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Audit', '00000000000011', 'test-tenant-00000000000011') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await pool.end();
  });

  it('encadeia hash: o prev_hash do segundo registro é o hash do primeiro', async () => {
    const ctx = new TenantContext(pool);
    const audit = new AuditLogService();

    await ctx.run(tenantId, (client) =>
      audit.append(client, {
        tenantId,
        actorId,
        actorType: 'user',
        action: 'read',
        resourceType: 'laudo_psicologico',
        resourceId,
        occurredAt: new Date(),
      }),
    );

    await ctx.run(tenantId, (client) =>
      audit.append(client, {
        tenantId,
        actorId,
        actorType: 'user',
        action: 'export',
        resourceType: 'laudo_psicologico',
        resourceId,
        occurredAt: new Date(),
      }),
    );

    // Verificado por chain_seq, não mais por occurred_at (achado
    // [Important] #4 — occurred_at é dado de negócio fornecido pelo
    // chamador, não a posição real da entrada na cadeia; ver teste
    // dedicado abaixo para o cenário em que os dois divergem).
    const rows = await adminPool.query(
      `SELECT prev_hash, hash FROM audit_log_entry WHERE tenant_id = $1 ORDER BY chain_seq`,
      [tenantId],
    );

    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].prev_hash).toBeNull();
    expect(rows.rows[1].prev_hash).toBe(rows.rows[0].hash);
    expect(rows.rows[0].hash).not.toBe(rows.rows[1].hash);
  });

  it('[Critical] serializa appends concorrentes: cadeia permanece linear e sem prev_hash duplicado', async () => {
    const ctx = new TenantContext(pool);
    const audit = new AuditLogService();
    const N = 10;

    // Reproduz a race relatada na revisão: N chamadas de append() disparadas
    // ao mesmo tempo (Promise.all) contra o MESMO tenant. Sem o advisory
    // lock por tenant em append(), transações concorrentes em READ
    // COMMITTED liam o mesmo "último hash" antes de qualquer commit e
    // várias gravavam o mesmo prev_hash (reproduzido antes da correção: 7
    // de 10 escritas colidindo no mesmo predecessor, 8 pontas de cadeia
    // onde deveria haver 1).
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        ctx.run(tenantId, (client) =>
          audit.append(client, {
            tenantId,
            actorId,
            actorType: 'user',
            action: `concurrent_${i}`,
            resourceType: 'laudo_psicologico',
            resourceId,
            occurredAt: new Date(),
          }),
        ),
      ),
    );

    const rows = await adminPool.query<{ prev_hash: string | null; hash: string }>(
      `SELECT prev_hash, hash FROM audit_log_entry
       WHERE tenant_id = $1 AND action LIKE 'concurrent_%'
       ORDER BY chain_seq`,
      [tenantId],
    );

    expect(rows.rows).toHaveLength(N);

    // count(DISTINCT prev_hash) = count(*): nenhuma bifurcação, nenhum par
    // de escritas concorrentes leu o mesmo predecessor.
    const prevHashes = rows.rows.map((r) => r.prev_hash);
    expect(new Set(prevHashes).size).toBe(N);

    // A cadeia é estritamente linear: cada elo aponta para o hash do
    // elemento imediatamente anterior por chain_seq — exatamente uma
    // "ponta" (o último elemento não é prev_hash de ninguém).
    for (let i = 1; i < rows.rows.length; i++) {
      expect(rows.rows[i].prev_hash).toBe(rows.rows[i - 1].hash);
    }
  });

  it('[Important, 4a rodada] lock por tenant serializa mesmo com tenantId chegando em CASES diferentes entre chamadas concorrentes', async () => {
    const ctx = new TenantContext(pool);
    const audit = new AuditLogService();
    const N = 10;
    const tenantIdUpper = tenantId.toUpperCase();

    // Metade das chamadas concorrentes envia entry.tenantId em minúscula
    // (forma canônica devolvida pelo Postgres ao criar o tenant), metade em
    // MAIÚSCULA — simulando dois requests do mesmo tenant chegando com case
    // diferente no header x-tenant-id (tenant-transaction.middleware.ts lê
    // req.header('x-tenant-id') sem normalizar, então isso é plausível na
    // prática). ctx.run() continua usando o tenantId original só para
    // configurar app.tenant_id da RLS nesta conexão — a variável que
    // importa para o achado é entry.tenantId, usado por append() para
    // derivar a chave do advisory lock.
    //
    // Antes da correção da 4a rodada, hashtext() sobre o texto cru gerava
    // chaves de advisory lock DIFERENTES para os dois cases, então a
    // serialização não acontecia entre os dois grupos de 5 — e quando as
    // duas metades liam o "último chain_seq" quase ao mesmo tempo, uma das
    // escritas colidia com a outra na mesma posição e falhava com
    // "duplicate key value violates unique constraint" (a UNIQUE(tenant_id,
    // chain_seq) da migration trust_0002 evitava corrupção silenciosa da
    // cadeia, mas derrubava a escrita — e a transação de negócio junto, já
    // que estão na mesma transação).
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        ctx.run(tenantId, (client) =>
          audit.append(client, {
            tenantId: i % 2 === 0 ? tenantId : tenantIdUpper,
            actorId,
            actorType: 'user',
            action: `case_mismatch_${i}`,
            resourceType: 'laudo_psicologico',
            resourceId,
            occurredAt: new Date(),
          }),
        ),
      ),
    );

    const rows = await adminPool.query<{ prev_hash: string | null; hash: string }>(
      `SELECT prev_hash, hash FROM audit_log_entry
       WHERE tenant_id = $1 AND action LIKE 'case_mismatch_%'
       ORDER BY chain_seq`,
      [tenantId],
    );

    // Todas as N escritas foram aceitas — nenhuma falhou por ter colidido
    // com outra escrita concorrente do mesmo tenant na mesma posição da
    // cadeia, mesmo com o tenantId chegando em cases diferentes.
    expect(rows.rows).toHaveLength(N);

    const prevHashes = rows.rows.map((r) => r.prev_hash);
    expect(new Set(prevHashes).size).toBe(N);

    for (let i = 1; i < rows.rows.length; i++) {
      expect(rows.rows[i].prev_hash).toBe(rows.rows[i - 1].hash);
    }
  });

  it('[Important] cadeia permanece verificável mesmo com occurred_at fora de ordem (evento atrasado)', async () => {
    const ctx = new TenantContext(pool);
    const audit = new AuditLogService();

    const t2 = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Audit OOO', '00000000000012', 'test-tenant-00000000000012') RETURNING id`,
    );
    const tenant2 = t2.rows[0].id;

    try {
      // Mesmo cenário reproduzido na revisão: 10h, depois 12h, depois um
      // evento de 11h que chega e é GRAVADO por último (ex.: outbox
      // reprocessando um evento atrasado — cenário da Task 14).
      await ctx.run(tenant2, (client) =>
        audit.append(client, {
          tenantId: tenant2,
          actorId,
          actorType: 'user',
          action: 'evento_10h',
          resourceType: 'laudo_psicologico',
          resourceId,
          occurredAt: new Date('2026-07-25T10:00:00.000Z'),
        }),
      );
      await ctx.run(tenant2, (client) =>
        audit.append(client, {
          tenantId: tenant2,
          actorId,
          actorType: 'user',
          action: 'evento_12h',
          resourceType: 'laudo_psicologico',
          resourceId,
          occurredAt: new Date('2026-07-25T12:00:00.000Z'),
        }),
      );
      await ctx.run(tenant2, (client) =>
        audit.append(client, {
          tenantId: tenant2,
          actorId,
          actorType: 'user',
          action: 'evento_11h_atrasado',
          resourceType: 'laudo_psicologico',
          resourceId,
          occurredAt: new Date('2026-07-25T11:00:00.000Z'),
        }),
      );

      const byChainSeq = await adminPool.query<{
        action: string;
        prev_hash: string | null;
        hash: string;
      }>(
        `SELECT action, prev_hash, hash FROM audit_log_entry WHERE tenant_id = $1 ORDER BY chain_seq`,
        [tenant2],
      );

      // Ordem real da cadeia é a ordem de inserção (chain_seq), não a
      // ordem de occurred_at.
      expect(byChainSeq.rows.map((r) => r.action)).toEqual([
        'evento_10h',
        'evento_12h',
        'evento_11h_atrasado',
      ]);
      expect(byChainSeq.rows[0].prev_hash).toBeNull();
      expect(byChainSeq.rows[1].prev_hash).toBe(byChainSeq.rows[0].hash);
      expect(byChainSeq.rows[2].prev_hash).toBe(byChainSeq.rows[1].hash);

      // Prova de que o cenário realmente exercita a divergência: ordenar
      // as mesmas linhas por occurred_at dá uma ordem DIFERENTE da ordem
      // real da cadeia — é exatamente essa divergência que antes fazia um
      // verificador que lesse ORDER BY occurred_at (como o teste original
      // desta task) declarar cadeia quebrada em dados honestos.
      const byOccurredAt = await adminPool.query<{ action: string }>(
        `SELECT action FROM audit_log_entry WHERE tenant_id = $1 ORDER BY occurred_at`,
        [tenant2],
      );
      expect(byOccurredAt.rows.map((r) => r.action)).toEqual([
        'evento_10h',
        'evento_11h_atrasado',
        'evento_12h',
      ]);
    } finally {
      await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenant2]);
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenant2]);
    }
  });

  it('[Important] detecta adulteração de fields_read/on_behalf_of/ip/user_agent/request_id feita direto no banco', async () => {
    const ctx = new TenantContext(pool);
    const audit = new AuditLogService();

    const original: AuditLogEntryInput = {
      tenantId,
      actorId,
      actorType: 'user',
      action: 'export_lgpd',
      resourceType: 'laudo_psicologico',
      resourceId,
      onBehalfOf: actorId,
      fieldsRead: ['cpf', 'diagnostico', 'conclusao'],
      ip: '203.0.113.5',
      userAgent: 'jest-test',
      requestId: 'req-original',
      occurredAt: new Date(),
    };

    await ctx.run(tenantId, (client) => audit.append(client, original));

    const before = await adminPool.query<{
      id: string;
      prev_hash: string | null;
      hash: string;
      chain_seq: string;
      occurred_at: Date;
    }>(
      `SELECT id, prev_hash, hash, chain_seq, occurred_at FROM audit_log_entry
       WHERE tenant_id = $1 AND action = 'export_lgpd'`,
      [tenantId],
    );
    const row = before.rows[0];

    // O hash gravado bate com o payload original recomputado com a mesma
    // fórmula usada por append() — prova de que computeEntryHash cobre de
    // fato os campos de conteúdo LGPD-sensíveis (fields_read, on_behalf_of).
    const recomputedOriginal = computeEntryHash(row.prev_hash, row.id, BigInt(row.chain_seq), {
      ...original,
      occurredAt: row.occurred_at,
    });
    expect(recomputedOriginal).toBe(row.hash);

    // Reescreve os campos de conteúdo direto no banco, como dono da tabela
    // (bypassa o REVOKE UPDATE do app_runtime — exatamente o ator do
    // modelo de ameaça descrito no achado: quem tem acesso privilegiado ao
    // Postgres).
    await adminPool.query(
      `UPDATE audit_log_entry
         SET fields_read = $1, on_behalf_of = NULL, ip = $2, user_agent = $3, request_id = $4
       WHERE id = $5`,
      [['nome'], '127.0.0.1', 'forjado-agent', 'req-forjado', row.id],
    );

    // O hash gravado (imutável — UPDATE não recalcula hash) não bate mais
    // com o payload adulterado: a cadeia agora detecta a adulteração.
    const recomputedTampered = computeEntryHash(row.prev_hash, row.id, BigInt(row.chain_seq), {
      ...original,
      onBehalfOf: undefined,
      fieldsRead: ['nome'],
      ip: '127.0.0.1',
      userAgent: 'forjado-agent',
      requestId: 'req-forjado',
      occurredAt: row.occurred_at,
    });
    expect(recomputedTampered).not.toBe(row.hash);
  });

  it('[Important, 4a rodada] hash recomputado a partir da LINHA DO BANCO bate mesmo com uuid em caixa alta / ip não-comprimido enviados pelo chamador', async () => {
    const ctx = new TenantContext(pool);
    const audit = new AuditLogService();

    // actor_id/ip são colunas tipadas (uuid/inet) que o Postgres NORMALIZA
    // na gravação. Enviamos deliberadamente formas NÃO-canônicas — uuid em
    // caixa alta e um IPv6 totalmente expandido — para forçar a
    // normalização a acontecer de verdade.
    const actorIdUpper = 'AAAAAAAA-1111-1111-1111-111111111111';
    const ipExpanded = '2001:0db8:0000:0000:0000:0000:0000:0001';

    await ctx.run(tenantId, (client) =>
      audit.append(client, {
        tenantId,
        actorId: actorIdUpper,
        actorType: 'user',
        action: 'canonicalizacao_uuid_ip',
        resourceType: 'laudo_psicologico',
        resourceId,
        ip: ipExpanded,
        occurredAt: new Date(),
      }),
    );

    // Simula um verificador EXTERNO: ele não tem acesso ao payload original
    // em memória, só à linha gravada no banco (via adminPool, papel de
    // dono da tabela/auditor externo).
    const row = (
      await adminPool.query<{
        id: string;
        tenant_id: string;
        actor_id: string | null;
        actor_type: string;
        on_behalf_of: string | null;
        action: string;
        resource_type: string;
        resource_id: string | null;
        fields_read: string[] | null;
        ip: string | null;
        user_agent: string | null;
        request_id: string | null;
        occurred_at: Date;
        prev_hash: string | null;
        hash: string;
        chain_seq: string;
      }>(
        `SELECT id, tenant_id, actor_id, actor_type, on_behalf_of, action, resource_type,
                resource_id, fields_read, ip, user_agent, request_id, occurred_at,
                prev_hash, hash, chain_seq
           FROM audit_log_entry
          WHERE tenant_id = $1 AND action = 'canonicalizacao_uuid_ip'`,
        [tenantId],
      )
    ).rows[0];

    // Prova de que o Postgres de fato normalizou os valores enviados pelo
    // chamador: o actor_id gravado está em minúsculas (não o
    // "AAAAAAAA-..." enviado) e o ip gravado está comprimido (não o
    // "2001:0db8:0000:..." enviado).
    expect(row.actor_id).toBe(actorIdUpper.toLowerCase());
    expect(row.actor_id).not.toBe(actorIdUpper);
    expect(row.ip).not.toBe(ipExpanded);

    // O ponto central do teste: recomputa o hash a partir dos valores LIDOS
    // DO BANCO (canônicos) — não do payload original em memória que o
    // chamador enviou. Antes da correção da 4a rodada, append() hasheava a
    // string CRUA recebida do chamador, então este recálculo (o único que
    // um verificador externo consegue fazer, já que só tem a linha do
    // banco) divergia do hash gravado mesmo sem nenhuma adulteração real —
    // falso positivo de adulteração.
    const recomputedFromRow = computeEntryHash(row.prev_hash, row.id, BigInt(row.chain_seq), {
      tenantId: row.tenant_id,
      actorId: row.actor_id ?? undefined,
      actorType: row.actor_type,
      onBehalfOf: row.on_behalf_of ?? undefined,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id ?? undefined,
      fieldsRead: row.fields_read ?? undefined,
      ip: row.ip ?? undefined,
      userAgent: row.user_agent ?? undefined,
      requestId: row.request_id ?? undefined,
      occurredAt: row.occurred_at,
    });

    expect(recomputedFromRow).toBe(row.hash);
  });

  it('não permite UPDATE nem DELETE (append-only de verdade)', async () => {
    const rows = await adminPool.query<{ id: string }>(
      'SELECT id FROM audit_log_entry WHERE tenant_id = $1 LIMIT 1',
      [tenantId],
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(
        client.query(`UPDATE audit_log_entry SET action = 'forjado' WHERE id = $1`, [
          rows.rows[0].id,
        ]),
      ).rejects.toThrow();
      // A falha acima deixa a transação em estado abortado — ROLLBACK
      // limpa esse estado antes de abrir a próxima transação que testa
      // DELETE, sem precisar de uma segunda conexão.
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(
        client.query(`DELETE FROM audit_log_entry WHERE id = $1`, [rows.rows[0].id]),
      ).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

describe('computeEntryHash — canonicalização', () => {
  const base: Omit<AuditLogEntryInput, 'action' | 'resourceType' | 'actorId'> = {
    tenantId: 'aaaaaaaa-0000-0000-0000-000000000000',
    actorType: 'user',
    resourceId: '22222222-2222-2222-2222-222222222222',
    occurredAt: new Date('2026-07-25T12:00:00.000Z'),
  };
  const prevHash = 'abc123';
  const id = '33333333-3333-3333-3333-333333333333';
  const chainSeq = 1n;

  it('[Important] action/resourceType contendo o delimitador antigo pipe nao colidem mais', () => {
    // Mesma demonstração da revisão: X.action="read|export" +
    // X.resourceType="laudo_psicologico" vs Y.action="read" +
    // Y.resourceType="export|laudo_psicologico" — com o join('|') antigo,
    // as duas produziam a mesma string canônica e o mesmo hash.
    const hashX = computeEntryHash(prevHash, id, chainSeq, {
      ...base,
      actorId: undefined,
      action: 'read|export',
      resourceType: 'laudo_psicologico',
    });
    const hashY = computeEntryHash(prevHash, id, chainSeq, {
      ...base,
      actorId: undefined,
      action: 'read',
      resourceType: 'export|laudo_psicologico',
    });

    expect(hashX).not.toBe(hashY);
  });

  it('[Important] actorId ausente (undefined) e string vazia nao colidem mais', () => {
    const common = { ...base, action: 'read', resourceType: 'laudo_psicologico' };
    const hashUndefined = computeEntryHash(prevHash, id, chainSeq, {
      ...common,
      actorId: undefined,
    });
    const hashEmpty = computeEntryHash(prevHash, id, chainSeq, { ...common, actorId: '' });

    expect(hashUndefined).not.toBe(hashEmpty);
  });

  it('[Important] prevHash nulo (primeira entrada da cadeia) e string vazia literal nao colidem', () => {
    const common = { ...base, actorId: undefined, action: 'read', resourceType: 'laudo_psicologico' };
    const hashNullPrev = computeEntryHash(null, id, chainSeq, common);
    const hashEmptyPrev = computeEntryHash('', id, chainSeq, common);

    expect(hashNullPrev).not.toBe(hashEmptyPrev);
  });
});

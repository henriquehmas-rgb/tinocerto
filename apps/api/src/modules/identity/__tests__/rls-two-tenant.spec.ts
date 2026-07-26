import { Pool, type PoolClient } from 'pg';

// Pool de teste conectado explicitamente COMO app_runtime — nunca como
// owner/superuser, replicando a conexão real da aplicação. Todo teste que
// copiar este padrão (Tasks 6-14) deve conectar da mesma forma: se o teste
// conectar como o role dono do banco, RLS nunca é exercitado de verdade.
function appRuntimePool(): Pool {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  return new Pool({ connectionString: url.toString() });
}

// Helper de rollback seguro: garante ROLLBACK antes de release() mesmo
// quando o erro já esperado (RLS) deixou a transação em estado abortado.
// Sem isso, a conexão volta ao pool "suja" (em transação aberta ou
// abortada) e contamina o próximo client.query() que a reutilizar.
async function rollbackSafely(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Já abortada / já sem transação — nada a fazer.
  }
}

describe('RLS — isolamento de dois tenants em user_account', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    const a = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa A', '00000000000001') RETURNING id`,
    );
    const b = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa B', '00000000000002') RETURNING id`,
    );
    tenantAId = a.rows[0].id;
    tenantBId = b.rows[0].id;
  });

  afterAll(async () => {
    // Escopado pelos tenants do próprio teste (nunca DELETE sem WHERE) — e
    // executado ANTES do delete de tenant, porque user_account.tenant_id
    // referencia tenant(id): apagar o tenant primeiro violaria a FK.
    await adminPool.query('DELETE FROM user_account WHERE tenant_id IN ($1, $2)', [
      tenantAId,
      tenantBId,
    ]);
    await adminPool.query('DELETE FROM tenant WHERE id IN ($1, $2)', [tenantAId, tenantBId]);
    await adminPool.end();
  });

  it('conecta como app_runtime — não superuser, não bypassa RLS', async () => {
    const pool = appRuntimePool();
    const client = await pool.connect();
    try {
      const result = await client.query<{ user: string; rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT current_user AS user, rolsuper, rolbypassrls
           FROM pg_roles WHERE rolname = current_user`,
      );
      expect(result.rows[0].user).toBe('app_runtime');
      expect(result.rows[0].rolsuper).toBe(false);
      expect(result.rows[0].rolbypassrls).toBe(false);
    } finally {
      client.release();
      await pool.end();
    }
  });

  it('tenant A não lê nem escreve dado do tenant B (SELECT/INSERT)', async () => {
    const pool = appRuntimePool();

    // Tenant A insere e COMMITa na própria transação.
    const clientA = await pool.connect();
    try {
      await clientA.query('BEGIN');
      // SET LOCAL não aceita bind parameters ($1) na gramática do Postgres;
      // set_config(name, value, is_local=true) tem o mesmo efeito (escopo de
      // transação) mas aceita parâmetros com segurança.
      await clientA.query("SELECT set_config('app.tenant_id', $1, true)", [tenantAId]);
      await clientA.query(`INSERT INTO user_account (tenant_id, email) VALUES ($1, 'a@a.com')`, [
        tenantAId,
      ]);
      await clientA.query('COMMIT');
    } catch (err) {
      await rollbackSafely(clientA);
      throw err;
    } finally {
      clientA.release();
    }

    // Tenant B insere e COMMITa na PRÓPRIA transação, separada da tentativa
    // de forjar tenant_id abaixo. Se estivesse na mesma transação, o erro
    // esperado do INSERT forjado abortaria a transação inteira no Postgres
    // (uma vez abortada, COMMIT vira ROLLBACK silencioso) — derrubando
    // também o insert legítimo de b@b.com que o teste quer validar.
    const clientB1 = await pool.connect();
    try {
      await clientB1.query('BEGIN');
      await clientB1.query("SELECT set_config('app.tenant_id', $1, true)", [tenantBId]);
      await clientB1.query(`INSERT INTO user_account (tenant_id, email) VALUES ($1, 'b@b.com')`, [
        tenantBId,
      ]);

      // Tenant B tenta ler tudo — só pode ver o próprio registro.
      const rows = await clientB1.query('SELECT * FROM user_account');
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].email).toBe('b@b.com');

      await clientB1.query('COMMIT');
    } catch (err) {
      await rollbackSafely(clientB1);
      throw err;
    } finally {
      clientB1.release();
    }

    // Tentativa de forjar tenant_id, em transação PRÓPRIA — isolada para que
    // o ROLLBACK dela não afete o insert de b@b.com já commitado acima.
    const clientB2 = await pool.connect();
    try {
      await clientB2.query('BEGIN');
      await clientB2.query("SELECT set_config('app.tenant_id', $1, true)", [tenantBId]);

      // Tenant B tenta escrever um registro se passando por tenant A — o
      // WITH CHECK da RESTRICTIVE deve recusar. Código 42501
      // (insufficient_privilege) é o erro específico que o Postgres lança
      // para violação de política RLS — .rejects.toThrow() genérico
      // passaria mesmo se o INSERT falhasse por outro motivo (ex.: coluna
      // errada, tabela sem permissão), mascarando um teste que não testa
      // mais o que diz testar.
      await expect(
        clientB2.query(`INSERT INTO user_account (tenant_id, email) VALUES ($1, 'forjado@a.com')`, [
          tenantAId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });

      await rollbackSafely(clientB2);
    } catch (err) {
      await rollbackSafely(clientB2);
      throw err;
    } finally {
      clientB2.release();
    }

    await pool.end();
  });

  it('tenant B não move registro para o tenant A via UPDATE cross-tenant', async () => {
    const pool = appRuntimePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantBId]);

      // B tenta mover o PRÓPRIO registro para o tenant A trocando o
      // tenant_id — o WITH CHECK da RESTRICTIVE recusa mesmo sendo o dono
      // da linha, porque a linha resultante não pertenceria mais à sessão.
      await expect(
        client.query(`UPDATE user_account SET tenant_id = $1 WHERE email = 'b@b.com'`, [tenantAId]),
      ).rejects.toMatchObject({ code: '42501' });

      await rollbackSafely(client);
    } catch (err) {
      await rollbackSafely(client);
      throw err;
    } finally {
      client.release();
    }

    // Em transação própria: B tenta atualizar (às cegas) uma linha que
    // pertence ao tenant A. Aqui não há erro — a cláusula USING da
    // RESTRICTIVE já filtra a linha do WHERE antes do UPDATE enxergá-la,
    // então o resultado é 0 linhas afetadas, não uma exceção.
    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');
      await client2.query("SELECT set_config('app.tenant_id', $1, true)", [tenantBId]);

      const blind = await client2.query(
        `UPDATE user_account SET status = 'inativo' WHERE email = 'a@a.com'`,
      );

      // Precondição explícita, via adminPool (sem RLS): prova que a linha
      // de a@a.com de fato existe. Sem isso, rowCount === 0 seria uma
      // asserção vazia — passaria tanto por RLS bloqueando de verdade
      // quanto por a linha simplesmente não existir mais (ex.: ordem de
      // execução alterada, afterAll de outro teste rodando cedo demais).
      const exists = await adminPool.query('SELECT 1 FROM user_account WHERE tenant_id = $1', [
        tenantAId,
      ]);
      expect(exists.rows.length).toBeGreaterThan(0);

      expect(blind.rowCount).toBe(0);

      await client2.query('COMMIT');
    } catch (err) {
      await rollbackSafely(client2);
      throw err;
    } finally {
      client2.release();
    }

    await pool.end();
  });

  it('sem set_config, nenhuma linha é visível mesmo havendo dados (falha fechada)', async () => {
    // Precondição explícita: confirma, via o pool admin (que enxerga tudo,
    // sem RLS), que já existem linhas na tabela antes de afirmar que a
    // sessão sem tenant_id vê zero. Sem isso, "0 linhas" seria uma
    // asserção vazia — passaria tanto por falha-fechada real quanto por
    // uma tabela vazia por acidente (ex.: afterAll de um teste anterior
    // rodou fora de ordem).
    const precondition = await adminPool.query<{ total: string }>(
      'SELECT count(*)::int AS total FROM user_account',
    );
    expect(Number(precondition.rows[0].total)).toBeGreaterThan(0);

    const pool = appRuntimePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Nenhum set_config('app.tenant_id', ...) executado de propósito.
      //
      // Achado Important #2 da verificação adversarial dos fixes finais da
      // Fase 0: o comportamento de current_setting('app.tenant_id', true)
      // aqui sem set_config prévio depende de a conexão ser NOVA ou
      // RECICLADA de um pool de longa duração:
      //   - Conexão NOVA (como esta -- appRuntimePool() acima cria um Pool
      //     novo por teste e este é o primeiro connect() dele): o GUC
      //     customizado nunca foi tocado nesta conexão física, então
      //     current_setting(..., true) retorna NULL. `tenant_id = NULL`
      //     nunca é verdadeiro -- a RESTRICTIVE barra tudo, 0 linhas.
      //   - Conexão RECICLADA de um pool de longa duração -- o caso real
      //     de DatabaseService em produção -- depois que QUALQUER
      //     transação anterior já setou app.tenant_id localmente (via
      //     set_config(..., true), o padrão de TenantContext.run()) e
      //     liberou a conexão de volta ao pool: o GUC customizado reverte
      //     para STRING VAZIA, não NULL. `''::uuid` estoura erro 22P02
      //     (invalid input syntax for type uuid) antes mesmo da RLS
      //     comparar a linha.
      // Os dois comportamentos são aceitáveis: ambos falham FECHADO (nenhum
      // vaza dado) -- só o formato da falha muda (0 linhas vs. erro
      // 22P02). Ver teste dedicado ao caminho de conexão reciclada em
      // database.service.spec.ts.
      const rows = await client.query('SELECT * FROM user_account');
      expect(rows.rows).toHaveLength(0);
      await client.query('COMMIT');
    } catch (err) {
      await rollbackSafely(client);
      throw err;
    } finally {
      client.release();
    }
    await pool.end();
  });

  it('tenant B não lê nem edita a linha do tenant A na tabela tenant', async () => {
    const pool = appRuntimePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantBId]);

      const rows = await client.query('SELECT * FROM tenant');
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].id).toBe(tenantBId);

      // Usa razao_social (não plano) porque app_runtime só tem GRANT de
      // UPDATE nas colunas razao_social/timezone/moeda (ver migration
      // identity_0002__tenant.sql) — plano/status são operação
      // administrativa e nem chegam a ser avaliadas pela RLS: um UPDATE
      // que sequer toque nessas colunas já falha por falta de privilégio
      // de coluna, antes de qualquer verificação de linha.
      await expect(
        client.query(`UPDATE tenant SET razao_social = 'hackeado' WHERE id = $1`, [tenantAId]),
      ).resolves.toMatchObject({ rowCount: 0 });

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    await pool.end();
  });
});

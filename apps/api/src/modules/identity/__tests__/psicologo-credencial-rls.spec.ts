import { Pool, type PoolClient } from 'pg';

// Pool de teste conectado explicitamente COMO app_runtime — nunca como
// owner/superuser, replicando a conexão real da aplicação (mesmo padrão
// de rls-two-tenant.spec.ts).
function appRuntimePool(): Pool {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  return new Pool({ connectionString: url.toString() });
}

// Helper de rollback seguro: garante ROLLBACK antes de release() mesmo
// quando o erro já esperado (RLS) deixou a transação em estado abortado.
async function rollbackSafely(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Já abortada / já sem transação — nada a fazer.
  }
}

// Regressão do achado CRITICAL 2 da revisão final consolidada da Fase 0:
// psicologo_credencial nasceu sem tenant_id e sem RLS (identity_0006,
// Task 6), e a revisão reproduziu ao vivo — conectado como app_runtime
// com app.tenant_id de um tenant B — SELECT, UPDATE (crp_ativo para
// true) e DELETE bem-sucedidos contra a credencial CRP de um psicólogo de
// OUTRO tenant, sem nenhum erro de permissão. identity_0008 fecha isso
// com tenant_id NOT NULL + FK composta + RLS completo. Este teste
// reproduz o ataque exato e prova que agora falha — não com uma exceção
// (RLS filtra silenciosamente, não lança), mas com CONTAGEM de linhas
// retornadas/afetadas igual a zero.
describe('RLS — psicologo_credencial não vaza entre tenants', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantAId: string;
  let tenantBId: string;
  let psicologoAId: string;

  beforeAll(async () => {
    const a = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Clinica A', '00000000000044', 'test-tenant-00000000000044') RETURNING id`,
    );
    const b = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Clinica B', '00000000000021', 'test-tenant-00000000000021') RETURNING id`,
    );
    tenantAId = a.rows[0].id;
    tenantBId = b.rows[0].id;

    const psi = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'psicologo@a.com') RETURNING id`,
      [tenantAId],
    );
    psicologoAId = psi.rows[0].id;

    // crp_ativo começa false de propósito: reproduz o cenário exato da
    // revisão ("alterar crp_ativo dele para true") — se o UPDATE do
    // tenant B abaixo vazasse, o valor mudaria para true.
    await adminPool.query(
      `INSERT INTO psicologo_credencial (user_id, tenant_id, crp_numero, crp_uf, crp_ativo)
       VALUES ($1, $2, '06/12345', 'SP', false)`,
      [psicologoAId, tenantAId],
    );
  });

  afterAll(async () => {
    // Escopado pelos próprios dados do teste, executado antes dos deletes
    // de tenant/user_account por causa das FKs (mesma ordem de
    // rls-two-tenant.spec.ts).
    await adminPool.query('DELETE FROM psicologo_credencial WHERE user_id = $1', [psicologoAId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id IN ($1, $2)', [
      tenantAId,
      tenantBId,
    ]);
    await adminPool.query('DELETE FROM tenant WHERE id IN ($1, $2)', [tenantAId, tenantBId]);
    await adminPool.end();
  });

  it('precondição: a credencial foi criada com tenant_id do dono e crp_ativo=false', async () => {
    const row = await adminPool.query<{ tenant_id: string; crp_ativo: boolean }>(
      `SELECT tenant_id, crp_ativo FROM psicologo_credencial WHERE user_id = $1`,
      [psicologoAId],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].tenant_id).toBe(tenantAId);
    expect(row.rows[0].crp_ativo).toBe(false);
  });

  it('tenant B não LÊ a credencial CRP do psicólogo do tenant A (SELECT retorna 0 linhas)', async () => {
    const pool = appRuntimePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantBId]);

      const rows = await client.query('SELECT * FROM psicologo_credencial WHERE user_id = $1', [
        psicologoAId,
      ]);
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

  it('tenant B não ALTERA crp_ativo do psicólogo do tenant A (UPDATE afeta 0 linhas)', async () => {
    const pool = appRuntimePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantBId]);

      const result = await client.query(
        `UPDATE psicologo_credencial SET crp_ativo = true WHERE user_id = $1`,
        [psicologoAId],
      );
      expect(result.rowCount).toBe(0);

      await client.query('COMMIT');
    } catch (err) {
      await rollbackSafely(client);
      throw err;
    } finally {
      client.release();
    }
    await pool.end();

    // Confirma, via adminPool (sem RLS), que a linha de fato não mudou —
    // sem isso, rowCount === 0 seria uma asserção vazia caso a policy
    // estivesse ausente mas o UPDATE tivesse afetado outra linha por
    // engano.
    const check = await adminPool.query<{ crp_ativo: boolean }>(
      `SELECT crp_ativo FROM psicologo_credencial WHERE user_id = $1`,
      [psicologoAId],
    );
    expect(check.rows[0].crp_ativo).toBe(false);
  });

  it('tenant B não APAGA a credencial do psicólogo do tenant A (DELETE afeta 0 linhas)', async () => {
    const pool = appRuntimePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantBId]);

      const result = await client.query(`DELETE FROM psicologo_credencial WHERE user_id = $1`, [
        psicologoAId,
      ]);
      expect(result.rowCount).toBe(0);

      await client.query('COMMIT');
    } catch (err) {
      await rollbackSafely(client);
      throw err;
    } finally {
      client.release();
    }
    await pool.end();

    // Confirma, via adminPool, que a linha ainda existe de fato.
    const exists = await adminPool.query(
      'SELECT 1 FROM psicologo_credencial WHERE user_id = $1',
      [psicologoAId],
    );
    expect(exists.rows).toHaveLength(1);
  });

  it('tenant A continua lendo a própria credencial normalmente (isolamento não é bloqueio total)', async () => {
    const pool = appRuntimePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantAId]);

      const rows = await client.query('SELECT * FROM psicologo_credencial WHERE user_id = $1', [
        psicologoAId,
      ]);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].crp_numero).toBe('06/12345');

      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await pool.end();
  });

  it('FK composta rejeita tenant_id/user_id que não pertencem ao mesmo dono em user_account', async () => {
    // tenantBId com o user_id do psicólogo do tenant A viola
    // fk_psicologo_credencial_tenant_user (user_account não tem a linha
    // (tenantBId, psicologoAId) em UNIQUE (tenant_id, id)).
    await expect(
      adminPool.query(
        `INSERT INTO psicologo_credencial (user_id, tenant_id, crp_numero, crp_uf, crp_ativo)
         VALUES ($1, $2, '06/99999', 'RJ', false)`,
        [psicologoAId, tenantBId],
      ),
    ).rejects.toThrow();
  });
});

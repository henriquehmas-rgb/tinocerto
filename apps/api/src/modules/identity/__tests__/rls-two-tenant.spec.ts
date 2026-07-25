import { Pool } from 'pg';

// Pool de teste conectado explicitamente COMO app_runtime — nunca como
// owner/superuser, replicando a conexão real da aplicação.
function appRuntimePool(): Pool {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  return new Pool({ connectionString: url.toString() });
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
    await adminPool.query('DELETE FROM user_account');
    await adminPool.query('DELETE FROM tenant WHERE id IN ($1, $2)', [tenantAId, tenantBId]);
    await adminPool.end();
  });

  it('tenant A não lê nem escreve dado do tenant B', async () => {
    const pool = appRuntimePool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      // SET LOCAL não aceita bind parameters ($1) na gramática do Postgres;
      // set_config(name, value, is_local=true) tem o mesmo efeito (escopo de
      // transação) mas aceita parâmetros com segurança.
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantAId]);
      await client.query(`INSERT INTO user_account (tenant_id, email) VALUES ($1, 'a@a.com')`, [
        tenantAId,
      ]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');
      await client2.query("SELECT set_config('app.tenant_id', $1, true)", [tenantBId]);
      await client2.query(`INSERT INTO user_account (tenant_id, email) VALUES ($1, 'b@b.com')`, [
        tenantBId,
      ]);

      // Tenant B tenta ler tudo — só pode ver o próprio registro.
      const rows = await client2.query('SELECT * FROM user_account');
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].email).toBe('b@b.com');

      // Tenant B tenta escrever um registro se passando por tenant A —
      // o WITH CHECK deve recusar.
      await expect(
        client2.query(`INSERT INTO user_account (tenant_id, email) VALUES ($1, 'forjado@a.com')`, [
          tenantAId,
        ]),
      ).rejects.toThrow();

      await client2.query('COMMIT');
    } finally {
      client2.release();
    }

    await pool.end();
  });

  it('sem SET LOCAL, nenhuma linha é visível (falha fechada)', async () => {
    const pool = appRuntimePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Nenhum set_config('app.tenant_id', ...) executado de propósito.
      const rows = await client.query('SELECT * FROM user_account');
      expect(rows.rows).toHaveLength(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await pool.end();
  });
});

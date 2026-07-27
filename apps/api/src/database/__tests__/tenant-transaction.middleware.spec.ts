import { Pool } from 'pg';
import { TenantContext } from '../tenant-context';

describe('TenantContext.run', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const pool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Ctx', '00000000000006', 'test-tenant-00000000000006') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await pool.end();
  });

  it('executa a função dentro de uma transação com SET LOCAL já aplicado', async () => {
    const ctx = new TenantContext(pool);

    const result = await ctx.run(tenantId, async (client) => {
      await client.query(`INSERT INTO user_account (tenant_id, email) VALUES ($1, 'ctx@teste.com')`, [
        tenantId,
      ]);
      const rows = await client.query('SELECT * FROM user_account');
      return rows.rows;
    });

    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('ctx@teste.com');

    // Prova de commit real: reconsulta via conexão INDEPENDENTE (adminPool,
    // fora da transação de `ctx.run()`) -- se COMMIT não tivesse rodado, esta
    // linha não existiria aqui, mesmo que a asserção acima (dentro da mesma
    // transação) tivesse passado de qualquer forma.
    const persisted = await adminPool.query(
      `SELECT email FROM user_account WHERE tenant_id = $1 AND email = 'ctx@teste.com'`,
      [tenantId],
    );
    expect(persisted.rows).toHaveLength(1);
  });

  it('faz ROLLBACK se a função lançar', async () => {
    const ctx = new TenantContext(pool);

    await expect(
      ctx.run(tenantId, async (client) => {
        await client.query(`INSERT INTO user_account (tenant_id, email) VALUES ($1, 'rollback@teste.com')`, [
          tenantId,
        ]);
        throw new Error('erro proposital');
      }),
    ).rejects.toThrow('erro proposital');

    const rows = await adminPool.query(
      `SELECT * FROM user_account WHERE email = 'rollback@teste.com'`,
    );
    expect(rows.rows).toHaveLength(0);
  });
});

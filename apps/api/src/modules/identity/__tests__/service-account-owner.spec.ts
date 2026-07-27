import { Pool } from 'pg';

describe('service_account exige owner humano', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const t = await pool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa SA', '00000000000005', 'test-tenant-00000000000005') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const u = await pool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'dono@teste.com') RETURNING id`,
      [tenantId],
    );
    userId = u.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM service_account WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM user_account WHERE id = $1', [userId]);
    await pool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await pool.end();
  });

  it('rejeita service_account sem owner_user_id', async () => {
    await expect(
      pool.query(
        `INSERT INTO service_account (tenant_id, nome, scopes) VALUES ($1, 'chave sem dono', '{}')`,
        [tenantId],
      ),
    ).rejects.toThrow();
  });

  it('aceita service_account com owner_user_id preenchido', async () => {
    const sa = await pool.query<{ id: string }>(
      `INSERT INTO service_account (tenant_id, nome, scopes, owner_user_id)
       VALUES ($1, 'chave com dono', ARRAY['jobs:read'], $2) RETURNING id`,
      [tenantId, userId],
    );
    expect(sa.rows[0].id).toBeDefined();
  });
});

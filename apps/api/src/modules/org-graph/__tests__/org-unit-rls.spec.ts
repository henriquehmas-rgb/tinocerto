import { Pool } from 'pg';

describe('org_unit — ltree e isolamento de tenant', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Org', '00000000000003') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
  });

  it('resolve subárvore por prefixo de materialized_path', async () => {
    const empresa = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path)
       VALUES ($1, 'empresa', 'Matriz', 'empresa1') RETURNING id`,
      [tenantId],
    );
    const unidade = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, parent_id, tipo, nome, materialized_path)
       VALUES ($1, $2, 'unidade', 'Unidade POA', 'empresa1.unidade_poa') RETURNING id`,
      [tenantId, empresa.rows[0].id],
    );

    const sub = await adminPool.query(
      `SELECT id FROM org_unit WHERE tenant_id = $1 AND materialized_path <@ 'empresa1'::ltree`,
      [tenantId],
    );

    expect(sub.rows.map((r) => r.id).sort()).toEqual(
      [empresa.rows[0].id, unidade.rows[0].id].sort(),
    );
  });
});

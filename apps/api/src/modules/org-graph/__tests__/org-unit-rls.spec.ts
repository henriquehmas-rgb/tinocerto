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

  // Regressão do achado (medium) da revisão do Task 7 (fix round 1):
  // org_unit.parent_id (auto-referência de hierarquia, criada em
  // org_graph_0001__org_unit.sql, Fase 0) usava FK simples para
  // org_unit(id) — mesma classe de bug fechada em psicologo_credencial:
  // FK simples permite que um org_unit aponte parent_id para a linha de
  // OUTRO tenant, porque a checagem de FK do Postgres verifica apenas
  // existência da linha, não passa pela RLS. org_graph_0002 fecha isso
  // com FK composta (tenant_id, parent_id) -> org_unit(tenant_id, id).
  // Este teste reproduz o ataque exato e prova que o INSERT agora falha.
  it('FK composta rejeita org_unit.parent_id apontando para org_unit de outro tenant', async () => {
    const outroTenant = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Org Outro', '00000000000033') RETURNING id`,
    );
    const paiOutroTenant = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path)
       VALUES ($1, 'empresa', 'Matriz Outro Tenant', 'outro_tenant') RETURNING id`,
      [outroTenant.rows[0].id],
    );

    await expect(
      adminPool.query(
        `INSERT INTO org_unit (tenant_id, parent_id, tipo, nome, materialized_path)
         VALUES ($1, $2, 'unidade', 'Unidade Vazando Parent', 'empresa1.vazando_parent')`,
        [tenantId, paiOutroTenant.rows[0].id], // pai pertence a outroTenant, não a tenantId
      ),
    ).rejects.toThrow();

    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [outroTenant.rows[0].id]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenant.rows[0].id]);
  });
});

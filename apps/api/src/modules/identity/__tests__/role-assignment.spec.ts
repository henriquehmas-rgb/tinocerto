import { Pool } from 'pg';

describe('role e role_assignment', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  it('os 7 papéis de sistema existem com tenant_id nulo', async () => {
    const rows = await pool.query<{ nome: string }>(
      'SELECT nome FROM role WHERE tenant_id IS NULL ORDER BY nome',
    );
    expect(rows.rows.map((r) => r.nome).sort()).toEqual(
      [
        'admin_tenant',
        'candidato',
        'cliente_agencia',
        'entrevistador',
        'gestor_vaga',
        'psicologo_responsavel',
        'recrutador',
      ].sort(),
    );
  });

  it('atribui um papel a um usuário com escopo de org_unit', async () => {
    const tenant = await pool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Role', '00000000000004', 'test-tenant-00000000000004') RETURNING id`,
    );
    const tenantId = tenant.rows[0].id;

    const user = await pool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador@teste.com') RETURNING id`,
      [tenantId],
    );
    const role = await pool.query<{ id: string }>(
      `SELECT id FROM role WHERE nome = 'recrutador' AND tenant_id IS NULL`,
    );

    await pool.query(
      `INSERT INTO role_assignment (user_id, tenant_id, role_id, scope_path) VALUES ($1, $2, $3, 'empresa1.unidade_poa')`,
      [user.rows[0].id, tenantId, role.rows[0].id],
    );

    const assignment = await pool.query(
      `SELECT scope_path FROM role_assignment WHERE user_id = $1`,
      [user.rows[0].id],
    );
    expect(assignment.rows[0].scope_path).toBe('empresa1.unidade_poa');

    await pool.query('DELETE FROM role_assignment WHERE user_id = $1', [user.rows[0].id]);
    await pool.query('DELETE FROM user_account WHERE id = $1', [user.rows[0].id]);
    await pool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  });
});

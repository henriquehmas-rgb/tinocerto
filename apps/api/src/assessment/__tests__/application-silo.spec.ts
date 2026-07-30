import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';

describe('assessment_application (ponte tenant) e item_response (silo)', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  let tenantA: string;
  let tenantB: string;
  let aaDoA: string;

  beforeAll(async () => {
    const criarTenant = async (cnpj: string, nome: string) => {
      const t = await adminPool.query<{ id: string }>(
        `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ($1, $2, $3) RETURNING id`,
        [nome, cnpj, `test-tenant-${cnpj}`],
      );
      return t.rows[0].id;
    };
    tenantA = await criarTenant('00000000000049', 'Empresa Assess A');
    tenantB = await criarTenant('00000000000050', 'Empresa Assess B');

    const inst = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument (nome) VALUES ('Instrumento Silo Test') RETURNING id`,
    );
    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, true) RETURNING id`,
      [inst.rows[0].id],
    );

    // Cadeia mínima de Hiring para o tenant A.
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1,'empresa','Matriz','matriz') RETURNING id`,
      [tenantA],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1,$2,'Req Assess','aprovada',now()) RETURNING id`,
      [tenantA, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, canais) VALUES ($1,$2,'Vaga Assess','vaga-assess-silo','{}') RETURNING id`,
      [tenantA, req.rows[0].id],
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-assess-silo','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Assess Silo','silo@example.com')
       RETURNING id`,
    );
    const app = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantA, job.rows[0].id, person.rows[0].id],
    );
    const aa = await adminPool.query<{ id: string }>(
      `INSERT INTO assessment_application (tenant_id, application_id, person_id, instrument_version_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [tenantA, app.rows[0].id, person.rows[0].id, ver.rows[0].id],
    );
    aaDoA = aa.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM item_response');
    await adminPool.query('DELETE FROM assessment_application');
    await adminPool.query('DELETE FROM application WHERE tenant_id IN ($1,$2)', [tenantA, tenantB]);
    await adminPool.query('DELETE FROM job WHERE tenant_id IN ($1,$2)', [tenantA, tenantB]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id IN ($1,$2)', [tenantA, tenantB]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id IN ($1,$2)', [tenantA, tenantB]);
    await adminPool.query(`DELETE FROM person WHERE email_principal = 'silo@example.com'`);
    await adminPool.query('DELETE FROM instrument_version');
    await adminPool.query('DELETE FROM instrument');
    await adminPool.query('DELETE FROM tenant WHERE id IN ($1,$2)', [tenantA, tenantB]);
    await adminPool.end();
    await appPool.end();
  });

  it('tenant B não enxerga o assessment_application do tenant A', async () => {
    const ctx = new TenantContext(appPool);

    const comoB = await ctx.run(tenantB, (client) =>
      client.query('SELECT * FROM assessment_application WHERE id = $1', [aaDoA]),
    );
    expect(comoB.rows).toHaveLength(0);

    const comoA = await ctx.run(tenantA, (client) =>
      client.query('SELECT * FROM assessment_application WHERE id = $1', [aaDoA]),
    );
    expect(comoA.rows).toHaveLength(1);
  });

  it('assessment_application nasce como convidado e no nível de integridade 0', async () => {
    const row = await adminPool.query<{ status: string; nivel_integridade: number }>(
      'SELECT status, nivel_integridade FROM assessment_application WHERE id = $1',
      [aaDoA],
    );
    expect(row.rows[0].status).toBe('convidado');
    // Webcam off por padrão = nível 0 por padrão.
    expect(row.rows[0].nivel_integridade).toBe(0);
  });

  it('rejeita nível de integridade fora da faixa 0-4', async () => {
    await expect(
      adminPool.query('UPDATE assessment_application SET nivel_integridade = 7 WHERE id = $1', [aaDoA]),
    ).rejects.toThrow();
  });

  it('rejeita multiplicador de tempo fora dos valores documentados', async () => {
    await expect(
      adminPool.query('UPDATE assessment_application SET multiplicador_tempo = 3.0 WHERE id = $1', [aaDoA]),
    ).rejects.toThrow();
  });

  it('item_response não concede DELETE a app_runtime (a resposta é o dado que calibra)', async () => {
    const grants = await adminPool.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'item_response' AND grantee = 'app_runtime'`,
    );
    const tipos = grants.rows.map((r) => r.privilege_type);
    expect(tipos).toContain('SELECT');
    expect(tipos).toContain('INSERT');
    expect(tipos).not.toContain('DELETE');
  });

  it('item_response é global — não tem tenant_id (é silo, não ponte)', async () => {
    const col = await adminPool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'item_response' AND column_name = 'tenant_id'`,
    );
    expect(col.rows).toHaveLength(0);
  });
});

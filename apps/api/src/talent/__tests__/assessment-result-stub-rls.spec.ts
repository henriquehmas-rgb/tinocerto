import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';

describe('result_grant — RLS de dois tenants (schema stub da Task 4)', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantAId: string;
  let tenantBId: string;
  let personId: string;
  let assessmentResultId: string;
  let consentId: string;

  beforeAll(async () => {
    const tA = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Grant A', '00000000000014') RETURNING id`,
    );
    tenantAId = tA.rows[0].id;
    const tB = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Grant B', '00000000000015') RETURNING id`,
    );
    tenantBId = tB.rows[0].id;

    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-teste-grant', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Teste Grant', 'grant@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;

    const result = await adminPool.query<{ id: string }>(
      `INSERT INTO assessment_result (person_id, instrument_version_id) VALUES ($1, gen_random_uuid()) RETURNING id`,
      [personId],
    );
    assessmentResultId = result.rows[0].id;

    const consent = await adminPool.query<{ id: string }>(
      `INSERT INTO consent (person_id, finalidade, base_legal) VALUES ($1, 'reaproveitamento_resultado', 'consentimento_especifico') RETURNING id`,
      [personId],
    );
    consentId = consent.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM result_grant WHERE tenant_id IN ($1, $2)', [tenantAId, tenantBId]);
    await adminPool.query('DELETE FROM consent WHERE id = $1', [consentId]);
    await adminPool.query('DELETE FROM assessment_result WHERE id = $1', [assessmentResultId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.query('DELETE FROM tenant WHERE id IN ($1, $2)', [tenantAId, tenantBId]);
    await adminPool.end();
    await appPool.end();
  });

  it('tenant A não enxerga result_grant concedido ao tenant B', async () => {
    const ctx = new TenantContext(appPool);

    await ctx.run(tenantBId, (client) =>
      client.query(
        `INSERT INTO result_grant (assessment_result_id, tenant_id, consent_id) VALUES ($1, $2, $3)`,
        [assessmentResultId, tenantBId, consentId],
      ),
    );

    const asTenantA = await ctx.run(tenantAId, (client) =>
      client.query('SELECT * FROM result_grant WHERE assessment_result_id = $1', [assessmentResultId]),
    );
    expect(asTenantA.rows).toHaveLength(0);

    const asTenantB = await ctx.run(tenantBId, (client) =>
      client.query('SELECT * FROM result_grant WHERE assessment_result_id = $1', [assessmentResultId]),
    );
    expect(asTenantB.rows).toHaveLength(1);
  });
});

import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { CandidateTouchpointService } from '../candidate-touchpoint.service';

describe('CandidateTouchpointService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let personId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Touchpoint', '00000000000034', 'test-tenant-00000000000034') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-touchpoint', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Teste Touchpoint', 'touchpoint@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM candidate_touchpoint WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('registra um touchpoint e o grava como append-only', async () => {
    const ctx = new TenantContext(appPool);
    const service = new CandidateTouchpointService();

    const { id } = await ctx.run(tenantId, (client) =>
      service.record(client, { tenantId, personId, canal: 'site_carreiras', campanha: 'lancamento_2026' }),
    );

    const row = await adminPool.query('SELECT * FROM candidate_touchpoint WHERE id = $1', [id]);
    expect(row.rows[0].canal).toBe('site_carreiras');
    expect(row.rows[0].campanha).toBe('lancamento_2026');
  });

  it('UPDATE em candidate_touchpoint é rejeitado mesmo como app_runtime (append-only de verdade)', async () => {
    const ctx = new TenantContext(appPool);
    const service = new CandidateTouchpointService();

    const { id } = await ctx.run(tenantId, (client) =>
      service.record(client, { tenantId, personId, canal: 'linkedin' }),
    );

    await expect(
      ctx.run(tenantId, (client) => client.query(`UPDATE candidate_touchpoint SET canal = 'forjado' WHERE id = $1`, [id])),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

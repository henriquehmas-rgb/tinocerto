import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { JobCustomFieldService } from '../job-custom-field.service';

describe('JobCustomFieldService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let jobId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa CustomField', '00000000000024') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req CF', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, canais) VALUES ($1, $2, 'Vaga CF', 'vaga-cf-test', '{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM job_custom_field WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('adiciona um campo neutro sem base legal (não é sensível, não precisa)', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobCustomFieldService();

    const { id } = await ctx.run(tenantId, (client) =>
      service.addField(client, { tenantId, jobId, label: 'Anos de experiência com Excel' }),
    );

    const row = await adminPool.query('SELECT label, base_legal FROM job_custom_field WHERE id = $1', [id]);
    expect(row.rows[0].label).toBe('Anos de experiência com Excel');
  });

  it('lista campos de uma vaga', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobCustomFieldService();

    const fields = await ctx.run(tenantId, (client) => service.listByJob(client, jobId));
    expect(fields.length).toBeGreaterThan(0);
  });
});

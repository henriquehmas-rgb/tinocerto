import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { JobCustomFieldService } from '../job-custom-field.service';
import { LiaDocumentService } from '../lia-document.service';

describe('LiaDocumentService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let fieldId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa LIA', '00000000000030') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req LIA', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, canais) VALUES ($1, $2, 'Vaga LIA', 'vaga-lia-test', '{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    const ctx = new TenantContext(appPool);
    const customFieldService = new JobCustomFieldService();
    const field = await ctx.run(tenantId, (client) =>
      customFieldService.addField(client, {
        tenantId,
        jobId: job.rows[0].id,
        label: 'Disponibilidade para viagens frequentes',
        baseLegal: 'legitimo_interesse',
      }),
    );
    fieldId = field.id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM lia_document WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job_custom_field WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('cria um LIA gerado a partir do template para um campo', async () => {
    const ctx = new TenantContext(appPool);
    const service = new LiaDocumentService();

    const { id } = await ctx.run(tenantId, (client) =>
      service.createForField(client, {
        tenantId,
        jobCustomFieldId: fieldId,
        campoLabel: 'Disponibilidade para viagens frequentes',
        finalidade: 'Avaliar aderência a cargo com viagens semanais',
      }),
    );
    expect(id).toBeDefined();
  });
});

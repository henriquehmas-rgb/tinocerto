import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { RequisitionService } from '../requisition.service';
import { JobService } from '../job.service';
import { JobRecrutadorService } from '../job-recrutador.service';
import { JobCustomFieldService } from '../job-custom-field.service';
import { LiaDocumentService } from '../lia-document.service';

describe('JobService.publish — exige LIA quando base legal é legítimo interesse', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let requisitionId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa LIA Gate', '00000000000031', 'test-tenant-00000000000031') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req LIA Gate', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    requisitionId = req.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM lia_document WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job_custom_field WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('bloqueia publish com base legal "legitimo_interesse" sem LIA gerado', async () => {
    const ctx = new TenantContext(appPool);
    const jobService = new JobService(new RequisitionService(), new JobRecrutadorService());
    const customFieldService = new JobCustomFieldService();

    const { id: jobId } = await ctx.run(tenantId, (client) =>
      jobService.create(client, { tenantId, requisitionId, titulo: 'Vaga Sem LIA' }),
    );
    await ctx.run(tenantId, (client) =>
      customFieldService.addField(client, {
        tenantId,
        jobId,
        label: 'Disponibilidade para viagens frequentes',
        baseLegal: 'legitimo_interesse',
      }),
    );

    await expect(
      ctx.run(tenantId, (client) => jobService.publish(client, jobId, ['site_carreiras'])),
    ).rejects.toThrow(/LIA/);
  });

  it('permite publish quando o LIA foi gerado para o campo', async () => {
    const ctx = new TenantContext(appPool);
    const jobService = new JobService(new RequisitionService(), new JobRecrutadorService());
    const customFieldService = new JobCustomFieldService();
    const liaService = new LiaDocumentService();

    const { id: jobId } = await ctx.run(tenantId, (client) =>
      jobService.create(client, { tenantId, requisitionId, titulo: 'Vaga Com LIA' }),
    );
    const { id: fieldId } = await ctx.run(tenantId, (client) =>
      customFieldService.addField(client, {
        tenantId,
        jobId,
        label: 'Disponibilidade para viagens frequentes',
        baseLegal: 'legitimo_interesse',
      }),
    );
    await ctx.run(tenantId, (client) =>
      liaService.createForField(client, {
        tenantId,
        jobCustomFieldId: fieldId,
        campoLabel: 'Disponibilidade para viagens frequentes',
        finalidade: 'Avaliar aderência a cargo com viagens semanais',
      }),
    );

    await expect(
      ctx.run(tenantId, (client) => jobService.publish(client, jobId, ['site_carreiras'])),
    ).resolves.toBeUndefined();
  });
});

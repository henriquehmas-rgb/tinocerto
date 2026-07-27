import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { RequisitionService } from '../requisition.service';
import { JobService } from '../job.service';
import { JobCustomFieldService } from '../job-custom-field.service';

describe('JobService.publish — bloqueio do linter de categoria sensível', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let requisitionId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Linter Publish', '00000000000025', 'test-tenant-00000000000025') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Linter', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    requisitionId = req.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job_custom_field WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('bloqueia publish se houver campo sensível sem base legal declarada', async () => {
    const ctx = new TenantContext(appPool);
    const jobService = new JobService(new RequisitionService());
    const customFieldService = new JobCustomFieldService();

    const { id: jobId } = await ctx.run(tenantId, (client) =>
      jobService.create(client, { tenantId, requisitionId, titulo: 'Vaga com Pergunta Sensível' }),
    );
    await ctx.run(tenantId, (client) =>
      customFieldService.addField(client, {
        tenantId,
        jobId,
        label: 'Você tem variações de humor com frequência?',
        // baseLegal ausente de propósito
      }),
    );

    await expect(
      ctx.run(tenantId, (client) => jobService.publish(client, jobId, ['site_carreiras'])),
    ).rejects.toThrow(/base legal/);
  });

  it('permite publish quando o campo sensível TEM base legal declarada', async () => {
    const ctx = new TenantContext(appPool);
    const jobService = new JobService(new RequisitionService());
    const customFieldService = new JobCustomFieldService();

    const { id: jobId } = await ctx.run(tenantId, (client) =>
      jobService.create(client, { tenantId, requisitionId, titulo: 'Vaga com Base Legal' }),
    );
    await ctx.run(tenantId, (client) =>
      customFieldService.addField(client, {
        tenantId,
        jobId,
        label: 'Qual sua religião ou crença espiritual?',
        baseLegal: 'consentimento_especifico_art_11',
      }),
    );

    await expect(
      ctx.run(tenantId, (client) => jobService.publish(client, jobId, ['site_carreiras'])),
    ).resolves.toBeUndefined();
  });

  it('permite publish quando não há nenhum campo sensível', async () => {
    const ctx = new TenantContext(appPool);
    const jobService = new JobService(new RequisitionService());
    const customFieldService = new JobCustomFieldService();

    const { id: jobId } = await ctx.run(tenantId, (client) =>
      jobService.create(client, { tenantId, requisitionId, titulo: 'Vaga Sem Pergunta Sensível' }),
    );
    await ctx.run(tenantId, (client) =>
      customFieldService.addField(client, { tenantId, jobId, label: 'Anos de experiência com liderança' }),
    );

    await expect(
      ctx.run(tenantId, (client) => jobService.publish(client, jobId, ['site_carreiras'])),
    ).resolves.toBeUndefined();
  });
});

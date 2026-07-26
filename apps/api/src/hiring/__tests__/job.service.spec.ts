import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { RequisitionService } from '../requisition.service';
import { JobService } from '../job.service';

describe('JobService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let orgUnitId: string;
  let requisitionId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Job', '00000000000018') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    orgUnitId = org.rows[0].id;
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Requisição para Job', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnitId],
    );
    requisitionId = req.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('cria uma vaga em rascunho com seo_slug único e sem publicado_em', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobService(new RequisitionService());

    const { id } = await ctx.run(tenantId, (client) =>
      service.create(client, { tenantId, requisitionId, titulo: 'Analista de Operações Pleno' }),
    );

    const row = await adminPool.query('SELECT * FROM job WHERE id = $1', [id]);
    expect(row.rows[0].seo_slug).toMatch(/^analista-de-operacoes-pleno-[0-9a-f]{4}$/);
    expect(row.rows[0].publicado_em).toBeNull();
  });

  it('publica uma vaga e grava job.published com os canais informados', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobService(new RequisitionService());

    const { id } = await ctx.run(tenantId, (client) =>
      service.create(client, { tenantId, requisitionId, titulo: 'Vaga a Publicar' }),
    );

    await ctx.run(tenantId, (client) => service.publish(client, id, ['site_carreiras', 'google_for_jobs']));

    const row = await adminPool.query('SELECT publicado_em, canais FROM job WHERE id = $1', [id]);
    expect(row.rows[0].publicado_em).not.toBeNull();
    expect(row.rows[0].canais).toEqual(['site_carreiras', 'google_for_jobs']);

    const events = await adminPool.query(
      `SELECT payload FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'job.published'`,
      [id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload.canais).toEqual(['site_carreiras', 'google_for_jobs']);
  });

  it('rejeita criar vaga para requisição de outro tenant (FK composta barra a referência)', async () => {
    const outroTenant = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Job Outro', '00000000000019') RETURNING id`,
    );
    const ctx = new TenantContext(appPool);
    const service = new JobService(new RequisitionService());

    await expect(
      ctx.run(outroTenant.rows[0].id, (client) =>
        service.create(client, {
          tenantId: outroTenant.rows[0].id,
          requisitionId, // pertence ao tenant original, não a outroTenant
          titulo: 'Vaga Vazando Requisição',
        }),
      ),
    ).rejects.toThrow();

    await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenant.rows[0].id]);
  });
});

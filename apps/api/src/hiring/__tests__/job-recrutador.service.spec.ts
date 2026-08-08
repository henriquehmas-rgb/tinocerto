import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { JobRecrutadorService } from '../job-recrutador.service';

describe('JobRecrutadorService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let orgUnitId: string;
  let requisitionId: string;
  let jobId: string;
  let recrutadorA: string;
  let recrutadorB: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Job Recrutador', '00000000000238', 'test-tenant-00000000000238') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    orgUnitId = org.rows[0].id;
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Requisição para Job Recrutador', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnitId],
    );
    requisitionId = req.rows[0].id;
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga com Recrutadores', 'vaga-com-recrutadores-0238') RETURNING id`,
      [tenantId, requisitionId],
    );
    jobId = job.rows[0].id;
    const staffA = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador-a@empresa-238.example') RETURNING id`,
      [tenantId],
    );
    recrutadorA = staffA.rows[0].id;
    const staffB = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador-b@empresa-238.example') RETURNING id`,
      [tenantId],
    );
    recrutadorB = staffB.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM job_recrutador WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('atribui recrutadores a uma vaga e depois lista os mesmos ids', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobRecrutadorService();

    await ctx.run(tenantId, (client) =>
      service.atribuir(client, { tenantId, jobId, recrutadorIds: [recrutadorA, recrutadorB] }),
    );

    const ids = await ctx.run(tenantId, (client) => service.listarPorVaga(client, { tenantId, jobId }));
    expect(ids.sort()).toEqual([recrutadorA, recrutadorB].sort());
  });

  it('exigirAcesso não lança para admin_tenant mesmo sem estar em job_recrutador', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobRecrutadorService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.exigirAcesso(client, {
          tenantId,
          jobId,
          userId: '00000000-0000-0000-0000-000000000000',
          userRoles: ['admin_tenant'],
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('exigirAcesso lança NotFoundException para recrutador não atribuído', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobRecrutadorService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.exigirAcesso(client, {
          tenantId,
          jobId,
          userId: '11111111-1111-1111-1111-111111111111',
          userRoles: ['recrutador'],
        }),
      ),
    ).rejects.toThrow('não encontrada');
  });
});

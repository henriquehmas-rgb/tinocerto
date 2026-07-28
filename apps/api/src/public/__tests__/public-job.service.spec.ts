import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { PublicJobService } from '../public-job.service';
import { JobCustomFieldService } from '../../hiring/job-custom-field.service';

describe('PublicJobService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let jobPublicadoId: string;
  let jobRascunhoId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Public Job', '00000000000041', 'empresa-public-job-test') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Public Job', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const jobPublicado = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, descricao, seo_slug, publicado_em, canais)
       VALUES ($1, $2, 'Vaga Publicada', 'Descrição da vaga', 'vaga-publicada-public-test', now(), '{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobPublicadoId = jobPublicado.rows[0].id;
    const jobRascunho = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Rascunho', 'vaga-rascunho-public-test') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobRascunhoId = jobRascunho.rows[0].id;

    const ctx = new TenantContext(appPool);
    const customFieldService = new JobCustomFieldService();
    await ctx.run(tenantId, (client) =>
      customFieldService.addField(client, { tenantId, jobId: jobPublicadoId, label: 'Anos de experiência' }),
    );
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

  it('listPublished retorna só vagas publicadas, nunca rascunhos', async () => {
    const ctx = new TenantContext(appPool);
    const service = new PublicJobService();

    const jobs = await ctx.run(tenantId, (client) => service.listPublished(client, tenantId));

    expect(jobs.some((j) => j.id === jobPublicadoId)).toBe(true);
    expect(jobs.some((j) => j.id === jobRascunhoId)).toBe(false);
  });

  it('findPublicBySlug retorna a vaga publicada com os campos do form builder', async () => {
    const ctx = new TenantContext(appPool);
    const service = new PublicJobService();

    const job = await ctx.run(tenantId, (client) => service.findPublicBySlug(client, tenantId, 'vaga-publicada-public-test'));

    expect(job).not.toBeNull();
    expect(job!.titulo).toBe('Vaga Publicada');
    expect(job!.camposCustomizados).toHaveLength(1);
    expect(job!.camposCustomizados[0].label).toBe('Anos de experiência');
  });

  it('findPublicBySlug retorna null para vaga em rascunho (não publicada)', async () => {
    const ctx = new TenantContext(appPool);
    const service = new PublicJobService();

    const job = await ctx.run(tenantId, (client) => service.findPublicBySlug(client, tenantId, 'vaga-rascunho-public-test'));

    expect(job).toBeNull();
  });
});

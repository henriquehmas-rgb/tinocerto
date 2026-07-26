import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { JobCustomFieldService } from '../job-custom-field.service';

describe('JobCustomFieldService — bloqueio duro Lei 9.029/95', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let jobIdComum: string;
  let jobIdSeguranca: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Hard Block', '00000000000026') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req HB', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const jobComum = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, canais) VALUES ($1, $2, 'Vaga Comum', 'vaga-comum-hb', '{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobIdComum = jobComum.rows[0].id;
    const jobSeguranca = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, canais, natureza_cargo) VALUES ($1, $2, 'Vigilante', 'vigilante-hb', '{}', 'seguranca_patrimonial') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobIdSeguranca = jobSeguranca.rows[0].id;
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

  it('rejeita pergunta sobre gravidez incondicionalmente, mesmo com base legal declarada', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobCustomFieldService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.addField(client, {
          tenantId,
          jobId: jobIdComum,
          label: 'Você está grávida atualmente?',
          baseLegal: 'consentimento_do_titular',
        }),
      ),
    ).rejects.toThrow(/bloqueio duro/);
  });

  it('rejeita antecedentes criminais em vaga comum (fora da lista fechada)', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobCustomFieldService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.addField(client, {
          tenantId,
          jobId: jobIdComum,
          label: 'Anexe sua certidão de antecedentes criminais',
          justificativa: 'Política interna',
        }),
      ),
    ).rejects.toThrow(/natureza de cargo/);
  });

  it('rejeita antecedentes criminais em vaga elegível sem justificativa', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobCustomFieldService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.addField(client, {
          tenantId,
          jobId: jobIdSeguranca,
          label: 'Anexe sua certidão de antecedentes criminais',
        }),
      ),
    ).rejects.toThrow(/justificativa/);
  });

  it('permite antecedentes criminais em vaga de segurança patrimonial com justificativa', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobCustomFieldService();

    const { id } = await ctx.run(tenantId, (client) =>
      service.addField(client, {
        tenantId,
        jobId: jobIdSeguranca,
        label: 'Anexe sua certidão de antecedentes criminais',
        justificativa: 'Cargo de vigilante patrimonial exige verificação por política de segurança do cliente contratante',
      }),
    );
    expect(id).toBeDefined();
  });
});

// apps/api/src/platform-api/__tests__/service-account-crp-link.service.spec.ts
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { ServiceAccountCrpLinkService } from '../service-account-crp-link.service';

describe('ServiceAccountCrpLinkService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const service = new ServiceAccountCrpLinkService();

  let tenantId: string;
  let adminUserId: string;
  let psiAtivoUserId: string;
  let psiInativoUserId: string;
  let userSemCredencialId: string;
  let serviceAccountId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('CRP Link Ltda','00000000000170','test-tenant-00000000000170') RETURNING id`,
    );
    tenantId = t.rows[0].id;

    const admin = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'admin-170@example.com') RETURNING id`,
      [tenantId],
    );
    adminUserId = admin.rows[0].id;

    const psiAtivo = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'psi-ativo-170@example.com') RETURNING id`,
      [tenantId],
    );
    psiAtivoUserId = psiAtivo.rows[0].id;
    await adminPool.query(
      `INSERT INTO psicologo_credencial (tenant_id, user_id, crp_numero, crp_uf, crp_ativo, verificado_em, verificado_por)
       VALUES ($1, $2, '111111', 'SP', true, now(), $3)`,
      [tenantId, psiAtivoUserId, adminUserId],
    );

    const psiInativo = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'psi-inativo-170@example.com') RETURNING id`,
      [tenantId],
    );
    psiInativoUserId = psiInativo.rows[0].id;
    await adminPool.query(
      `INSERT INTO psicologo_credencial (tenant_id, user_id, crp_numero, crp_uf, crp_ativo)
       VALUES ($1, $2, '222222', 'RJ', false)`,
      [tenantId, psiInativoUserId],
    );

    const semCredencial = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'sem-credencial-170@example.com') RETURNING id`,
      [tenantId],
    );
    userSemCredencialId = semCredencial.rows[0].id;

    const sa = await adminPool.query<{ id: string }>(
      `INSERT INTO service_account (tenant_id, nome, owner_user_id) VALUES ($1, 'Integração 170', $2) RETURNING id`,
      [tenantId, adminUserId],
    );
    serviceAccountId = sa.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM service_account_crp_link WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM service_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM psicologo_credencial WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('sem vínculo, resolveCrpAttrs devolve null', async () => {
    const attrs = await tenantContext.run(tenantId, (client) => service.resolveCrpAttrs(client, serviceAccountId));
    expect(attrs).toBeNull();
  });

  it('link + resolveCrpAttrs devolve os atributos do CRP ativo vinculado', async () => {
    await tenantContext.run(tenantId, (client) =>
      service.link(client, { tenantId, serviceAccountId, userId: psiAtivoUserId, vinculadoPor: adminUserId }),
    );
    const attrs = await tenantContext.run(tenantId, (client) => service.resolveCrpAttrs(client, serviceAccountId));
    expect(attrs).toEqual({ crp_ativo: true, crp_numero: '111111', crp_uf: 'SP' });

    await tenantContext.run(tenantId, (client) => service.unlink(client, { tenantId, serviceAccountId }));
  });

  it('vínculo a CRP inativo devolve crp_ativo: false explicitamente (não null)', async () => {
    await tenantContext.run(tenantId, (client) =>
      service.link(client, { tenantId, serviceAccountId, userId: psiInativoUserId, vinculadoPor: adminUserId }),
    );
    const attrs = await tenantContext.run(tenantId, (client) => service.resolveCrpAttrs(client, serviceAccountId));
    expect(attrs).toEqual({ crp_ativo: false, crp_numero: '222222', crp_uf: 'RJ' });

    await tenantContext.run(tenantId, (client) => service.unlink(client, { tenantId, serviceAccountId }));
  });

  it('unlink remove o vínculo -- resolveCrpAttrs volta a null', async () => {
    await tenantContext.run(tenantId, (client) =>
      service.link(client, { tenantId, serviceAccountId, userId: psiAtivoUserId, vinculadoPor: adminUserId }),
    );
    await tenantContext.run(tenantId, (client) => service.unlink(client, { tenantId, serviceAccountId }));
    const attrs = await tenantContext.run(tenantId, (client) => service.resolveCrpAttrs(client, serviceAccountId));
    expect(attrs).toBeNull();
  });

  it('vincular a um usuário SEM linha em psicologo_credencial falha na FK (rejeição estrutural)', async () => {
    await expect(
      tenantContext.run(tenantId, (client) =>
        service.link(client, { tenantId, serviceAccountId, userId: userSemCredencialId, vinculadoPor: adminUserId }),
      ),
    ).rejects.toThrow();
  });
});

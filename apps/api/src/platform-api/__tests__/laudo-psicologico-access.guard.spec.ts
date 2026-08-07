// apps/api/src/platform-api/__tests__/laudo-psicologico-access.guard.spec.ts
import { ExecutionContext } from '@nestjs/common';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { DatabaseService } from '../../database/database.service';
import { CerbosService } from '../../authz/cerbos.service';
import { ServiceAccountCrpLinkService } from '../service-account-crp-link.service';
import { LaudoPsicologicoAccessGuard } from '../laudo-psicologico-access.guard';
import { PlatformApiProblem } from '../platform-api-problem';

function fakeContext(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('LaudoPsicologicoAccessGuard', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const databaseService = { pool: appPool } as DatabaseService;
  const linkService = new ServiceAccountCrpLinkService();
  const cerbosService = new CerbosService(process.env.CERBOS_HTTP_URL!);
  const guard = new LaudoPsicologicoAccessGuard(linkService, cerbosService, databaseService);

  let tenantId: string;
  let adminUserId: string;
  let psiAtivoUserId: string;
  let psiInativoUserId: string;
  let serviceAccountId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Laudo Guard Ltda','00000000000175','test-tenant-00000000000175') RETURNING id`,
    );
    tenantId = t.rows[0].id;

    const admin = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'admin-175@example.com') RETURNING id`,
      [tenantId],
    );
    adminUserId = admin.rows[0].id;

    const psiAtivo = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'psi-ativo-175@example.com') RETURNING id`,
      [tenantId],
    );
    psiAtivoUserId = psiAtivo.rows[0].id;
    await adminPool.query(
      `INSERT INTO psicologo_credencial (tenant_id, user_id, crp_numero, crp_uf, crp_ativo, verificado_em, verificado_por)
       VALUES ($1, $2, '333333', 'SP', true, now(), $3)`,
      [tenantId, psiAtivoUserId, adminUserId],
    );

    const psiInativo = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'psi-inativo-175@example.com') RETURNING id`,
      [tenantId],
    );
    psiInativoUserId = psiInativo.rows[0].id;
    await adminPool.query(
      `INSERT INTO psicologo_credencial (tenant_id, user_id, crp_numero, crp_uf, crp_ativo)
       VALUES ($1, $2, '444444', 'RJ', false)`,
      [tenantId, psiInativoUserId],
    );

    const sa = await adminPool.query<{ id: string }>(
      `INSERT INTO service_account (tenant_id, nome, owner_user_id) VALUES ($1, 'Integração Laudo 175', $2) RETURNING id`,
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

  it('1. sem o escopo psych:report.read -- 403 escopo-insuficiente', async () => {
    const req = { tenantId, userId: serviceAccountId, userRoles: ['service_account'], apiKeyScopes: ['applications:read'], params: {} };
    try {
      await guard.canActivate(fakeContext(req));
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformApiProblem);
      expect((err as PlatformApiProblem).getProblemBody().typeSlug).toBe('escopo-insuficiente');
    }
  });

  it('2. com escopo, SEM vínculo de CRP -- 403 crp-nao-vinculado-ou-inativo', async () => {
    const req = { tenantId, userId: serviceAccountId, userRoles: ['service_account'], apiKeyScopes: ['psych:report.read'], params: {} };
    try {
      await guard.canActivate(fakeContext(req));
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformApiProblem);
      expect((err as PlatformApiProblem).getProblemBody().typeSlug).toBe('crp-nao-vinculado-ou-inativo');
    }
  });

  it('3. com escopo, vinculado a humano com crp_ativo=true -- permite (true)', async () => {
    await tenantContext.run(tenantId, (client) =>
      linkService.link(client, { tenantId, serviceAccountId, userId: psiAtivoUserId, vinculadoPor: adminUserId }),
    );
    const req = { tenantId, userId: serviceAccountId, userRoles: ['service_account'], apiKeyScopes: ['psych:report.read'], params: {} };
    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    await tenantContext.run(tenantId, (client) => linkService.unlink(client, { tenantId, serviceAccountId }));
  });

  it('4. com escopo, vinculado a humano com crp_ativo=FALSE -- 403 (o vínculo não contorna a checagem de vivacidade)', async () => {
    await tenantContext.run(tenantId, (client) =>
      linkService.link(client, { tenantId, serviceAccountId, userId: psiInativoUserId, vinculadoPor: adminUserId }),
    );
    const req = { tenantId, userId: serviceAccountId, userRoles: ['service_account'], apiKeyScopes: ['psych:report.read'], params: {} };
    try {
      await guard.canActivate(fakeContext(req));
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformApiProblem);
      expect((err as PlatformApiProblem).getProblemBody().typeSlug).toBe('crp-nao-vinculado-ou-inativo');
    }
    await tenantContext.run(tenantId, (client) => linkService.unlink(client, { tenantId, serviceAccountId }));
  });
});

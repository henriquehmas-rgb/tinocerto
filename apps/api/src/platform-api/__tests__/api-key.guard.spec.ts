import { ExecutionContext } from '@nestjs/common';
import { Pool } from 'pg';
import { ApiKeyService } from '../api-key.service';
import { ApiKeyGuard } from '../api-key.guard';
import { PlatformApiProblem } from '../platform-api-problem';
import { TenantContext } from '../../database/tenant-context';

function fakeContext(headers: Record<string, string | undefined>) {
  const req: Record<string, unknown> = { header: (name: string) => headers[name.toLowerCase()] };
  const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { context, req };
}

describe('ApiKeyGuard', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const apiKeyService = new ApiKeyService(appPool);
  const guard = new ApiKeyGuard(apiKeyService);

  let tenantId: string;
  let serviceAccountId: string;
  let rawKey: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('ApiKeyGuard Ltda','00000000000145','test-tenant-00000000000145') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const owner = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'owner-145@example.com') RETURNING id`,
      [tenantId],
    );
    const sa = await adminPool.query<{ id: string }>(
      `INSERT INTO service_account (tenant_id, nome, owner_user_id) VALUES ($1, 'Integração 145', $2) RETURNING id`,
      [tenantId, owner.rows[0].id],
    );
    serviceAccountId = sa.rows[0].id;
    const issued = await tenantContext.run(tenantId, (client) =>
      apiKeyService.issue(client, { tenantId, serviceAccountId, escopos: ['applications:read'] }),
    );
    rawKey = issued.rawKey;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM api_key WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM service_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('sem Authorization -- 401 credenciais-invalidas', async () => {
    const { context } = fakeContext({});
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(PlatformApiProblem);
  });

  it('Authorization sem Bearer -- 401', async () => {
    const { context } = fakeContext({ authorization: 'Basic xyz' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(PlatformApiProblem);
  });

  it('chave válida -- popula tenantId/userId/userRoles/apiKeyScopes e devolve true', async () => {
    const { context, req } = fakeContext({ authorization: `Bearer ${rawKey}` });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.tenantId).toBe(tenantId);
    expect(req.userId).toBe(serviceAccountId);
    expect(req.userRoles).toEqual(['service_account']);
    expect(req.apiKeyScopes).toEqual(['applications:read']);
  });

  it('chave inválida -- 401', async () => {
    const { context } = fakeContext({ authorization: 'Bearer tnc_live_naoexisteXXXXXXXXXXXXXXXXXXXXXXXXX' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(PlatformApiProblem);
  });

  it('X-Api-Version divergente -- 400', async () => {
    const { context } = fakeContext({ authorization: `Bearer ${rawKey}`, 'x-api-version': '2020-01' });
    try {
      await guard.canActivate(context);
      throw new Error('deveria ter lançado PlatformApiProblem');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformApiProblem);
      expect((err as PlatformApiProblem).getStatus()).toBe(400);
    }
  });

  it('X-Api-Version igual à atual -- passa normalmente', async () => {
    const { context } = fakeContext({ authorization: `Bearer ${rawKey}`, 'x-api-version': '2026-08' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});

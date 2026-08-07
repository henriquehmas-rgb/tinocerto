import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { ApiKeyService } from '../api-key.service';

describe('ApiKeyService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const apiKeyService = new ApiKeyService(appPool);

  let tenantId: string;
  let serviceAccountId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('ApiKeyService Ltda','00000000000140','test-tenant-00000000000140') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const owner = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'owner-140@example.com') RETURNING id`,
      [tenantId],
    );
    const sa = await adminPool.query<{ id: string }>(
      `INSERT INTO service_account (tenant_id, nome, owner_user_id) VALUES ($1, 'Integração 140', $2) RETURNING id`,
      [tenantId, owner.rows[0].id],
    );
    serviceAccountId = sa.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM api_key WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM service_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('issue gera uma chave que authenticate resolve de volta para o tenant/service account/escopos certos', async () => {
    const issued = await tenantContext.run(tenantId, (client) =>
      apiKeyService.issue(client, { tenantId, serviceAccountId, escopos: ['applications:read'] }),
    );
    expect(issued.rawKey.startsWith('tnc_live_')).toBe(true);
    expect(issued.prefixo.length).toBeGreaterThan(0);

    const resolved = await apiKeyService.authenticate(issued.rawKey);
    expect(resolved).toEqual({ tenantId, serviceAccountId, escopos: ['applications:read'] });
  });

  it('chave com prefixo válido mas sufixo errado (hash não bate) devolve null, não lança', async () => {
    const issued = await tenantContext.run(tenantId, (client) =>
      apiKeyService.issue(client, { tenantId, serviceAccountId, escopos: [] }),
    );
    const adulterada = issued.rawKey.slice(0, -1) + (issued.rawKey.endsWith('a') ? 'b' : 'a');
    const resolved = await apiKeyService.authenticate(adulterada);
    expect(resolved).toBeNull();
  });

  it('chave de prefixo inexistente devolve null', async () => {
    const resolved = await apiKeyService.authenticate('tnc_live_naoexisteXXXXXXXXXXXXXXXXXXXXXXXXX');
    expect(resolved).toBeNull();
  });

  it('chave revogada devolve null mesmo com hash correto', async () => {
    const issued = await tenantContext.run(tenantId, (client) =>
      apiKeyService.issue(client, { tenantId, serviceAccountId, escopos: ['applications:read'] }),
    );
    await adminPool.query(`UPDATE api_key SET revogado_em = now() WHERE id = $1`, [issued.id]);
    const resolved = await apiKeyService.authenticate(issued.rawKey);
    expect(resolved).toBeNull();
  });

  it('duas chamadas de issue produzem prefixos e hashes distintos (sem colisão)', async () => {
    const a = await tenantContext.run(tenantId, (client) =>
      apiKeyService.issue(client, { tenantId, serviceAccountId, escopos: [] }),
    );
    const b = await tenantContext.run(tenantId, (client) =>
      apiKeyService.issue(client, { tenantId, serviceAccountId, escopos: [] }),
    );
    expect(a.prefixo).not.toBe(b.prefixo);
    expect(a.rawKey).not.toBe(b.rawKey);
  });
});

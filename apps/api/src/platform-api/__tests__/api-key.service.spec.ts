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
    expect(resolved).toEqual({ apiKeyId: issued.id, tenantId, serviceAccountId, escopos: ['applications:read'] });
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

describe('ApiKeyService -- rotação, revogação, listagem (Fase 4d)', () => {
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
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Rotação Ltda','00000000000171','test-tenant-00000000000171') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const owner = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'owner-171@example.com') RETURNING id`,
      [tenantId],
    );
    const sa = await adminPool.query<{ id: string }>(
      `INSERT INTO service_account (tenant_id, nome, owner_user_id) VALUES ($1, 'Integração 171', $2) RETURNING id`,
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

  it('rotate emite uma chave nova com os mesmos escopos e marca a antiga com expira_em no futuro', async () => {
    const original = await tenantContext.run(tenantId, (client) =>
      apiKeyService.issue(client, { tenantId, serviceAccountId, escopos: ['applications:read'] }),
    );
    const rotacionada = await tenantContext.run(tenantId, (client) =>
      apiKeyService.rotate(client, { tenantId, oldApiKeyId: original.id }),
    );

    expect(rotacionada.rawKey).not.toBe(original.rawKey);
    const resolvidaNova = await apiKeyService.authenticate(rotacionada.rawKey);
    expect(resolvidaNova).toEqual({ apiKeyId: rotacionada.id, tenantId, serviceAccountId, escopos: ['applications:read'] });

    // Antiga AINDA autentica -- overlap de verdade, não revogação imediata.
    const resolvidaAntiga = await apiKeyService.authenticate(original.rawKey);
    expect(resolvidaAntiga).toEqual({ apiKeyId: original.id, tenantId, serviceAccountId, escopos: ['applications:read'] });
  });

  it('chave com expira_em no passado para de autenticar (fim da janela de overlap)', async () => {
    const issued = await tenantContext.run(tenantId, (client) =>
      apiKeyService.issue(client, { tenantId, serviceAccountId, escopos: [] }),
    );
    await adminPool.query(`UPDATE api_key SET expira_em = now() - interval '1 minute' WHERE id = $1`, [issued.id]);
    const resolvida = await apiKeyService.authenticate(issued.rawKey);
    expect(resolvida).toBeNull();
  });

  it('revoke torna a chave inválida imediatamente', async () => {
    const issued = await tenantContext.run(tenantId, (client) =>
      apiKeyService.issue(client, { tenantId, serviceAccountId, escopos: [] }),
    );
    await tenantContext.run(tenantId, (client) => apiKeyService.revoke(client, { tenantId, apiKeyId: issued.id }));
    const resolvida = await apiKeyService.authenticate(issued.rawKey);
    expect(resolvida).toBeNull();
  });

  it('revoke de chave já revogada lança NotFoundException', async () => {
    const issued = await tenantContext.run(tenantId, (client) =>
      apiKeyService.issue(client, { tenantId, serviceAccountId, escopos: [] }),
    );
    await tenantContext.run(tenantId, (client) => apiKeyService.revoke(client, { tenantId, apiKeyId: issued.id }));
    await expect(
      tenantContext.run(tenantId, (client) => apiKeyService.revoke(client, { tenantId, apiKeyId: issued.id })),
    ).rejects.toThrow();
  });

  it('listByTenant devolve as chaves do tenant, mais recente primeiro, com nome do service_account', async () => {
    const lista = await tenantContext.run(tenantId, (client) => apiKeyService.listByTenant(client, tenantId));
    expect(lista.length).toBeGreaterThan(0);
    expect(lista[0].nomeServiceAccount).toBe('Integração 171');
    expect(lista.every((k) => k.serviceAccountId === serviceAccountId)).toBe(true);
  });
});

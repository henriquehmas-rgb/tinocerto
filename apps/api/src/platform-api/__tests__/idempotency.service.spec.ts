import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { IdempotencyService, hashRequestBody } from '../idempotency.service';

describe('IdempotencyService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const service = new IdempotencyService();

  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Idempotency Ltda','00000000000142','test-tenant-00000000000142') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM idempotency_key WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('chave nova -- status novo', async () => {
    const result = await tenantContext.run(tenantId, (client) =>
      service.checkOrReserve(client, { tenantId, chave: 'chave-a', hashDaRequisicao: hashRequestBody({ x: 1 }) }),
    );
    expect(result).toEqual({ status: 'novo' });
  });

  it('após store, mesma chave + mesmo hash -- status repetido com o snapshot certo', async () => {
    const hash = hashRequestBody({ x: 2 });
    await tenantContext.run(tenantId, (client) =>
      service.store(client, { tenantId, chave: 'chave-b', hashDaRequisicao: hash, respostaSnapshot: { ok: true, n: 2 } }),
    );
    const result = await tenantContext.run(tenantId, (client) =>
      service.checkOrReserve(client, { tenantId, chave: 'chave-b', hashDaRequisicao: hash }),
    );
    expect(result).toEqual({ status: 'repetido', respostaSnapshot: { ok: true, n: 2 } });
  });

  it('mesma chave, hash diferente -- status conflito', async () => {
    const hashOriginal = hashRequestBody({ x: 3 });
    await tenantContext.run(tenantId, (client) =>
      service.store(client, { tenantId, chave: 'chave-c', hashDaRequisicao: hashOriginal, respostaSnapshot: { ok: true } }),
    );
    const result = await tenantContext.run(tenantId, (client) =>
      service.checkOrReserve(client, { tenantId, chave: 'chave-c', hashDaRequisicao: hashRequestBody({ x: 999 }) }),
    );
    expect(result).toEqual({ status: 'conflito' });
  });

  it('linha expirada é tratada como nova', async () => {
    await tenantContext.run(tenantId, (client) =>
      service.store(client, { tenantId, chave: 'chave-d', hashDaRequisicao: hashRequestBody({}), respostaSnapshot: {} }),
    );
    // Força expiração diretamente -- não espera 24h de verdade.
    await adminPool.query(`UPDATE idempotency_key SET expira_em = now() - interval '1 minute' WHERE tenant_id = $1 AND chave = 'chave-d'`, [tenantId]);
    const result = await tenantContext.run(tenantId, (client) =>
      service.checkOrReserve(client, { tenantId, chave: 'chave-d', hashDaRequisicao: hashRequestBody({ qualquer: 'coisa' }) }),
    );
    expect(result).toEqual({ status: 'novo' });
  });

  it('isolamento de tenant: outro tenant com a mesma chave não vê o snapshot deste', async () => {
    await tenantContext.run(tenantId, (client) =>
      service.store(client, { tenantId, chave: 'chave-e', hashDaRequisicao: hashRequestBody({}), respostaSnapshot: { pertence: tenantId } }),
    );
    const outro = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Idempotency Outro Ltda','00000000000143','test-tenant-00000000000143') RETURNING id`,
    );
    try {
      const result = await tenantContext.run(outro.rows[0].id, (client) =>
        service.checkOrReserve(client, { tenantId: outro.rows[0].id, chave: 'chave-e', hashDaRequisicao: hashRequestBody({}) }),
      );
      expect(result).toEqual({ status: 'novo' });
    } finally {
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [outro.rows[0].id]);
    }
  });
});

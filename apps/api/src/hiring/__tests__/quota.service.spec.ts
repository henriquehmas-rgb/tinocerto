import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { QuotaService } from '../quota.service';

describe('QuotaService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Cotas', '00000000000028') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    await adminPool.query(`INSERT INTO tenant_quota_config (tenant_id, total_empregados) VALUES ($1, 350)`, [
      tenantId,
    ]);
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM tenant_quota_config WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('retorna status de cota calculado a partir do quadro do tenant', async () => {
    const ctx = new TenantContext(appPool);
    const service = new QuotaService();

    const status = await ctx.run(tenantId, (client) => service.getQuotaStatus(client, tenantId));

    expect(status.totalEmpregados).toBe(350);
    expect(status.pcdPercentMinimo).toBe(3);
    expect(status.pcdVagasMinimo).toBe(11);
    expect(status.aprendizRange).toEqual({ min: 18, max: 53 });
  });

  it('retorna zerado quando tenant não configurou o quadro', async () => {
    const t2 = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Sem Cota', '00000000000029') RETURNING id`,
    );
    const ctx = new TenantContext(appPool);
    const service = new QuotaService();

    const status = await ctx.run(t2.rows[0].id, (client) => service.getQuotaStatus(client, t2.rows[0].id));
    expect(status.totalEmpregados).toBe(0);
    expect(status.pcdPercentMinimo).toBe(0);

    await adminPool.query('DELETE FROM tenant WHERE id = $1', [t2.rows[0].id]);
  });
});

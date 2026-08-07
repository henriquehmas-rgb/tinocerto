import { Pool } from 'pg';
import { TenantContext } from '../../../database/tenant-context';
import { WebhookEndpointService } from '../webhook-endpoint.service';
import { decryptWebhookSecret } from '../webhook-secret-cipher';

describe('WebhookEndpointService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const service = new WebhookEndpointService();

  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Webhook Endpoint Ltda','00000000000152','test-tenant-00000000000152') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM webhook_endpoint WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('create devolve um segredo em claro que decifra de volta para o valor armazenado', async () => {
    const created = await tenantContext.run(tenantId, (client) =>
      service.create(client, { tenantId, url: 'https://exemplo.com.br/webhooks', eventosFiltro: ['application.created'] }),
    );
    expect(created.segredoAtual.startsWith('whsec_')).toBe(true);

    const row = await adminPool.query<{ segredo_atual_cifrado: unknown }>(
      `SELECT segredo_atual_cifrado FROM webhook_endpoint WHERE id = $1`,
      [created.id],
    );
    expect(decryptWebhookSecret(row.rows[0].segredo_atual_cifrado as any)).toBe(created.segredoAtual);
  });

  it('rotateSecret move o segredo antigo pro histórico, respeitando o cap de 2', async () => {
    const created = await tenantContext.run(tenantId, (client) =>
      service.create(client, { tenantId, url: 'https://exemplo.com.br/rotacao', eventosFiltro: [] }),
    );
    const primeiro = created.segredoAtual;
    await tenantContext.run(tenantId, (client) => service.rotateSecret(client, created.id));
    const rot2 = await tenantContext.run(tenantId, (client) => service.rotateSecret(client, created.id));
    const rot3 = await tenantContext.run(tenantId, (client) => service.rotateSecret(client, created.id));

    const row = await adminPool.query<{ segredos_historico_cifrados: unknown[] }>(
      `SELECT segredos_historico_cifrados FROM webhook_endpoint WHERE id = $1`,
      [created.id],
    );
    expect(row.rows[0].segredos_historico_cifrados).toHaveLength(2);
    const historicoDecifrado = (row.rows[0].segredos_historico_cifrados as any[]).map((h) => decryptWebhookSecret(h));
    expect(historicoDecifrado).not.toContain(primeiro);
    expect(rot3.segredoAtual).not.toBe(rot2.segredoAtual);
  });

  it('list decifra e expõe segredoAtual mas nunca expõe segredosHistorico', async () => {
    const created = await tenantContext.run(tenantId, (client) =>
      service.create(client, { tenantId, url: 'https://exemplo.com.br/list', eventosFiltro: [] }),
    );
    const listados = await tenantContext.run(tenantId, (client) => service.list(client));
    const item = listados.find((l) => l.id === created.id);
    expect(item?.segredoAtual).toBe(created.segredoAtual);
    expect((item as any).segredosHistorico).toBeUndefined();
  });

  it('isolamento de tenant real: outro tenant não vê os endpoints deste', async () => {
    const outro = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Webhook Endpoint Outro Ltda','00000000000153','test-tenant-00000000000153') RETURNING id`,
    );
    try {
      const listados = await tenantContext.run(outro.rows[0].id, (client) => service.list(client));
      expect(listados).toHaveLength(0);
    } finally {
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [outro.rows[0].id]);
    }
  });
});

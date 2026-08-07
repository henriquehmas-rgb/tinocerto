import { Pool } from 'pg';
import { TenantContext } from '../../../database/tenant-context';
import { WebhookEndpointService } from '../webhook-endpoint.service';
import { WebhookEndpointDisableScheduler } from '../webhook-endpoint-disable.scheduler';

describe('WebhookEndpointDisableScheduler.sweep', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const endpointService = new WebhookEndpointService();
  const scheduler = new WebhookEndpointDisableScheduler();

  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Webhook Disable Scheduler Ltda','00000000000158','test-tenant-00000000000158') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM webhook_endpoint WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
    await scheduler.onModuleDestroy();
  });

  it('endpoint com falha há >=5 dias e ativo=true é desativado e gera exatamente um outbox_event webhook.endpoint_disabled', async () => {
    const endpoint = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: 'https://exemplo.com.br/5dias', eventosFiltro: [] }),
    );
    await adminPool.query(`UPDATE webhook_endpoint SET primeira_falha_desde_ultimo_sucesso_em = now() - interval '5 days 1 hour' WHERE id = $1`, [endpoint.id]);

    await scheduler.sweep();

    const row = await adminPool.query(`SELECT ativo FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
    expect(row.rows[0].ativo).toBe(false);

    const eventos = await adminPool.query(`SELECT event_type FROM outbox_event WHERE aggregate_id = $1`, [endpoint.id]);
    expect(eventos.rows).toHaveLength(1);
    expect(eventos.rows[0].event_type).toBe('webhook.endpoint_disabled');
  });

  it('endpoint com falha há <5 dias não é tocado', async () => {
    const endpoint = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: 'https://exemplo.com.br/4dias', eventosFiltro: [] }),
    );
    await adminPool.query(`UPDATE webhook_endpoint SET primeira_falha_desde_ultimo_sucesso_em = now() - interval '4 days' WHERE id = $1`, [endpoint.id]);

    await scheduler.sweep();

    const row = await adminPool.query(`SELECT ativo FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
    expect(row.rows[0].ativo).toBe(true);
  });

  it('endpoint sem falha em aberto (NULL) nunca é candidato, mesmo criado há muito tempo', async () => {
    const endpoint = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: 'https://exemplo.com.br/sem-falha', eventosFiltro: [] }),
    );
    await adminPool.query(`UPDATE webhook_endpoint SET criado_em = now() - interval '30 days' WHERE id = $1`, [endpoint.id]);

    await scheduler.sweep();

    const row = await adminPool.query(`SELECT ativo FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
    expect(row.rows[0].ativo).toBe(true);
  });
});

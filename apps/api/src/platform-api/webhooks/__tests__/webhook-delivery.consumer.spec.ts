import { createServer, Server } from 'http';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DatabaseService } from '../../../database/database.service';
import { TenantContext } from '../../../database/tenant-context';
import { OutboxPublisher } from '../../../outbox/outbox-publisher.service';
import { WebhookDeliveryConsumer } from '../webhook-delivery.consumer';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import { WebhookEndpointService } from '../webhook-endpoint.service';

describe('WebhookDeliveryConsumer', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const endpointService = new WebhookEndpointService();
  const redis = new Redis(process.env.REDIS_URL!);
  const databaseService = { pool: appPool } as DatabaseService;
  const publisher = new OutboxPublisher(adminPool, redis);

  let tenantId: string;
  let server: Server;
  let serverPort: number;
  const requisicoesRecebidas: string[] = [];

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Webhook Delivery Consumer Ltda','00000000000156','test-tenant-00000000000156') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    server = createServer((req, res) => {
      requisicoesRecebidas.push(req.url ?? '');
      res.writeHead(200);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as any).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await adminPool.query('DELETE FROM webhook_delivery WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM webhook_endpoint WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await redis.del(`outbox:${tenantId}`);
    await redis.quit();
    await adminPool.end();
    await appPool.end();
  });

  it('evento publicado via OutboxPublisher real gera webhook_delivery só para endpoint ativo com eventos_filtro compatível; endpoint sem o evento no filtro e endpoint inativo não recebem nada; eventos_filtro vazio não recebe nada', async () => {
    const compativel = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: `http://127.0.0.1:${serverPort}`, eventosFiltro: ['gate.consumer_evento'] }),
    );
    const incompativel = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: `http://127.0.0.1:${serverPort}`, eventosFiltro: ['outro.evento'] }),
    );
    const vazio = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: `http://127.0.0.1:${serverPort}`, eventosFiltro: [] }),
    );
    const inativoRow = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: `http://127.0.0.1:${serverPort}`, eventosFiltro: ['gate.consumer_evento'] }),
    );
    await tenantContext.run(tenantId, (client) => endpointService.deactivate(client, inativoRow.id));

    await adminPool.query(
      `INSERT INTO outbox_event (tenant_id, aggregate_type, aggregate_id, event_type, sequence, payload, occurred_at)
       VALUES ($1, 'gate_teste', gen_random_uuid(), 'gate.consumer_evento', 1, '{"x":1}'::jsonb, now())`,
      [tenantId],
    );
    await publisher.publishPending();

    const consumer = new WebhookDeliveryConsumer(new WebhookDeliveryService(), databaseService);
    // ensureConsumerGroup/processBatch são privados -- acessados via cast
    // tipado de propósito, mesmo padrão já usado em
    // insights/adverse-impact.consumer.spec.ts (nunca `as any` solto).
    type ConsumerPrivates = { ensureConsumerGroup: (t: string) => Promise<void>; processBatch: (t: string, id: '0' | '>') => Promise<void> };
    const consumeUmaRodada = async () => {
      await (consumer as unknown as ConsumerPrivates).ensureConsumerGroup(tenantId);
      await (consumer as unknown as ConsumerPrivates).processBatch(tenantId, '0');
      await (consumer as unknown as ConsumerPrivates).processBatch(tenantId, '>');
    };
    await consumeUmaRodada();

    const entregasCompativel = await adminPool.query(`SELECT * FROM webhook_delivery WHERE webhook_endpoint_id = $1`, [compativel.id]);
    expect(entregasCompativel.rows).toHaveLength(1);

    const entregasIncompativel = await adminPool.query(`SELECT * FROM webhook_delivery WHERE webhook_endpoint_id = $1`, [incompativel.id]);
    expect(entregasIncompativel.rows).toHaveLength(0);

    const entregasVazio = await adminPool.query(`SELECT * FROM webhook_delivery WHERE webhook_endpoint_id = $1`, [vazio.id]);
    expect(entregasVazio.rows).toHaveLength(0);

    const entregasInativo = await adminPool.query(`SELECT * FROM webhook_delivery WHERE webhook_endpoint_id = $1`, [inativoRow.id]);
    expect(entregasInativo.rows).toHaveLength(0);
  }, 20_000);
});

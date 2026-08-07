// apps/api/src/platform-api/webhooks/__tests__/webhook-delivery.controller.spec.ts
import { createServer, Server } from 'http';
import { Pool } from 'pg';
import { TenantContext } from '../../../database/tenant-context';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import { WebhookEndpointService } from '../webhook-endpoint.service';
import { WebhookDeliveryController } from '../webhook-delivery.controller';

function fakeReq(tenantId: string) {
  return { tenantId, header: () => undefined } as any;
}

describe('WebhookDeliveryController (unitário, sem boot HTTP -- boot completo fica no gate)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const endpointService = new WebhookEndpointService();
  const deliveryService = new WebhookDeliveryService();
  const databaseService = { pool: appPool } as any;
  const controller = new WebhookDeliveryController(deliveryService, databaseService);

  let tenantId: string;
  let server: Server;
  let serverPort: number;
  let requisicoesRecebidas = 0;
  let statusASimular = 500;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Webhook Delivery Controller Ltda','00000000000159','test-tenant-00000000000159') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    server = createServer((req, res) => {
      requisicoesRecebidas++;
      res.writeHead(statusASimular);
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
    await adminPool.end();
    await appPool.end();
  });

  it('list pagina por cursor corretamente', async () => {
    const endpoint = await tenantContext.run(tenantId, (client) => endpointService.create(client, { tenantId, url: `http://127.0.0.1:${serverPort}`, eventosFiltro: [] }));
    for (let i = 0; i < 3; i++) {
      const eventoRow = await adminPool.query<{ id: string }>(
        `INSERT INTO outbox_event (tenant_id, aggregate_type, aggregate_id, event_type, sequence, payload, occurred_at)
         VALUES ($1, 'gate_teste', gen_random_uuid(), 'gate.controller', 1, '{}'::jsonb, now()) RETURNING id`,
        [tenantId],
      );
      await adminPool.query(
        `INSERT INTO webhook_delivery (tenant_id, webhook_endpoint_id, event_id, tentativa_num, corpo_enviado, assinatura_enviada, status_http, enviado_em)
         VALUES ($1,$2,$3,1,'{}'::jsonb,'v1,x',200, $4)`,
        [tenantId, endpoint.id, eventoRow.rows[0].id, new Date(Date.UTC(2026, 7, 1, 10, 0, i))],
      );
    }

    const pagina1 = await controller.list(fakeReq(tenantId), endpoint.id, { limit: 2 } as any);
    expect(pagina1.data).toHaveLength(2);
    expect(pagina1.has_more).toBe(true);

    const pagina2 = await controller.list(fakeReq(tenantId), endpoint.id, { limit: 2, cursor: pagina1.next_cursor! } as any);
    expect(pagina2.data).toHaveLength(1);
    expect(pagina2.has_more).toBe(false);
  });

  it('resend gera nova tentativa com tentativa_num = max+1; sucesso limpa a falha em aberto do endpoint; falha não agenda próxima automática', async () => {
    statusASimular = 500;
    const endpoint = await tenantContext.run(tenantId, (client) => endpointService.create(client, { tenantId, url: `http://127.0.0.1:${serverPort}`, eventosFiltro: [] }));
    const eventoRow = await adminPool.query<{ id: string }>(
      `INSERT INTO outbox_event (tenant_id, aggregate_type, aggregate_id, event_type, sequence, payload, occurred_at)
       VALUES ($1, 'gate_teste', gen_random_uuid(), 'gate.resend', 1, '{}'::jsonb, now()) RETURNING id`,
      [tenantId],
    );
    const endpointRow = await adminPool.query(`SELECT segredo_atual_cifrado, segredos_historico_cifrados FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
    await tenantContext.run(tenantId, (client) =>
      deliveryService.attemptDelivery(client, {
        tenantId,
        webhookEndpoint: { id: endpoint.id, url: `http://127.0.0.1:${serverPort}`, segredoAtualCifrado: endpointRow.rows[0].segredo_atual_cifrado, segredosHistoricoCifrados: endpointRow.rows[0].segredos_historico_cifrados },
        event: { id: eventoRow.rows[0].id, eventType: 'gate.resend', sequence: 1, occurredAt: new Date(), payload: {} },
        tentativaNum: 1,
      }),
    );

    const deliveryRow = await adminPool.query(`SELECT id FROM webhook_delivery WHERE webhook_endpoint_id = $1`, [endpoint.id]);

    // Reenvio manual falhando (statusASimular ainda 500).
    const respostaFalha = await controller.resend(fakeReq(tenantId), endpoint.id, deliveryRow.rows[0].id);
    expect(respostaFalha.sucesso).toBe(false);
    const gravado = await adminPool.query(`SELECT tentativa_num, proxima_tentativa_em FROM webhook_delivery WHERE webhook_endpoint_id = $1 ORDER BY tentativa_num DESC LIMIT 1`, [endpoint.id]);
    expect(gravado.rows[0].tentativa_num).toBe(2);
    expect(gravado.rows[0].proxima_tentativa_em).toBeNull();

    // Reenvio manual com sucesso.
    statusASimular = 200;
    const respostaSucesso = await controller.resend(fakeReq(tenantId), endpoint.id, deliveryRow.rows[0].id);
    expect(respostaSucesso.sucesso).toBe(true);
    const endpointFinal = await adminPool.query(`SELECT primeira_falha_desde_ultimo_sucesso_em FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
    expect(endpointFinal.rows[0].primeira_falha_desde_ultimo_sucesso_em).toBeNull();
  });
});

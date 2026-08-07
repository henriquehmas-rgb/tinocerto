import { createServer, Server } from 'http';
import { Pool } from 'pg';
import { TenantContext } from '../../../database/tenant-context';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import { WebhookEndpointService } from '../webhook-endpoint.service';
import { WebhookRetryScheduler } from '../webhook-retry.scheduler';

describe('WebhookRetryScheduler.processDueRetries', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const endpointService = new WebhookEndpointService();
  const deliveryService = new WebhookDeliveryService();
  const scheduler = new WebhookRetryScheduler(deliveryService);

  let tenantId: string;
  let server: Server;
  let serverPort: number;
  let corposRecebidos: string[] = [];
  let statusASimular = 500;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Webhook Retry Scheduler Ltda','00000000000157','test-tenant-00000000000157') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    server = createServer((req, res) => {
      let corpo = '';
      req.on('data', (chunk) => (corpo += chunk));
      req.on('end', () => {
        corposRecebidos.push(corpo);
        res.writeHead(statusASimular);
        res.end();
      });
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
    await scheduler.onModuleDestroy();
  });

  it('linha com proxima_tentativa_em no passado é pega e gera tentativa_num+1; corpo é idêntico ao da tentativa 1 (reconstrução determinística de outbox_event)', async () => {
    statusASimular = 500;
    const endpoint = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: `http://127.0.0.1:${serverPort}`, eventosFiltro: ['gate.retry'] }),
    );
    // Desvio do plano (documentado): a versão literal deste teste (Task 6
    // Step 2) passava `occurredAt: new Date()` (timestamp JS fabricado no
    // momento da chamada) para a tentativa 1, em vez do `occurred_at` REAL
    // gravado pelo INSERT em outbox_event. Isso quebra a própria asserção de
    // determinismo do teste: o WebhookRetryScheduler reconstrói occurredAt
    // lendo outbox_event.occurred_at do banco (o valor de `now()` no INSERT,
    // alguns milissegundos ANTES da chamada `new Date()` em JS), então os
    // dois corpos nunca batiam byte a byte -- confirmado ao rodar o teste
    // como escrito no plano (falhou por causa de occurred_at divergente em
    // milissegundos, não um flake). No fluxo real de produção
    // (WebhookDeliveryConsumer.handleMessage), occurredAt SEMPRE vem do
    // outbox_event.occurred_at original (via Redis XADD, que o
    // OutboxPublisher grava com o mesmo valor da coluna) -- nunca de
    // `new Date()` fabricado à parte. Corrigido capturando occurred_at via
    // RETURNING no INSERT e usando o mesmo valor na tentativa 1, para o
    // teste provar o determinismo real, não um artefato de fixture.
    const eventoRow = await adminPool.query<{ id: string; occurred_at: Date }>(
      `INSERT INTO outbox_event (tenant_id, aggregate_type, aggregate_id, event_type, sequence, payload, occurred_at)
       VALUES ($1, 'gate_teste', gen_random_uuid(), 'gate.retry', 1, '{"y":2}'::jsonb, now()) RETURNING id, occurred_at`,
      [tenantId],
    );
    const eventId = eventoRow.rows[0].id;
    const endpointRow = await adminPool.query(`SELECT segredo_atual_cifrado, segredos_historico_cifrados FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);

    // Tentativa 1 real (falha), com proxima_tentativa_em forçada pro passado.
    await tenantContext.run(tenantId, (client) =>
      deliveryService.attemptDelivery(client, {
        tenantId,
        webhookEndpoint: { id: endpoint.id, url: `http://127.0.0.1:${serverPort}`, segredoAtualCifrado: endpointRow.rows[0].segredo_atual_cifrado, segredosHistoricoCifrados: endpointRow.rows[0].segredos_historico_cifrados },
        event: { id: eventId, eventType: 'gate.retry', sequence: 1, occurredAt: eventoRow.rows[0].occurred_at, payload: { y: 2 } },
        tentativaNum: 1,
      }),
    );
    await adminPool.query(`UPDATE webhook_delivery SET proxima_tentativa_em = now() - interval '1 second' WHERE webhook_endpoint_id = $1 AND event_id = $2`, [endpoint.id, eventId]);

    await scheduler.processDueRetries();

    const tentativas = await adminPool.query(`SELECT tentativa_num, corpo_enviado FROM webhook_delivery WHERE webhook_endpoint_id = $1 AND event_id = $2 ORDER BY tentativa_num`, [endpoint.id, eventId]);
    expect(tentativas.rows.map((r) => r.tentativa_num)).toEqual([1, 2]);
    expect(JSON.stringify(tentativas.rows[0].corpo_enviado)).toBe(JSON.stringify(tentativas.rows[1].corpo_enviado));
  });

  it('linha com proxima_tentativa_em no futuro é ignorada', async () => {
    const endpoint = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: `http://127.0.0.1:${serverPort}`, eventosFiltro: ['gate.retry_futuro'] }),
    );
    const eventoRow = await adminPool.query<{ id: string }>(
      `INSERT INTO outbox_event (tenant_id, aggregate_type, aggregate_id, event_type, sequence, payload, occurred_at)
       VALUES ($1, 'gate_teste', gen_random_uuid(), 'gate.retry_futuro', 1, '{}'::jsonb, now()) RETURNING id`,
      [tenantId],
    );
    await adminPool.query(
      `INSERT INTO webhook_delivery (tenant_id, webhook_endpoint_id, event_id, tentativa_num, corpo_enviado, assinatura_enviada, status_http, enviado_em, proxima_tentativa_em)
       VALUES ($1,$2,$3,1,'{}'::jsonb,'v1,x',500, now(), now() + interval '1 hour')`,
      [tenantId, endpoint.id, eventoRow.rows[0].id],
    );

    await scheduler.processDueRetries();

    const tentativas = await adminPool.query(`SELECT tentativa_num FROM webhook_delivery WHERE webhook_endpoint_id = $1`, [endpoint.id]);
    expect(tentativas.rows).toHaveLength(1);
  });
});

import { createServer, Server } from 'http';
import { Pool } from 'pg';
import { TenantContext } from '../../../database/tenant-context';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import { WebhookEndpointService } from '../webhook-endpoint.service';

describe('WebhookDeliveryService.attemptDelivery', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const endpointService = new WebhookEndpointService();
  const deliveryService = new WebhookDeliveryService();

  let tenantId: string;
  let server: Server;
  let serverPort: number;
  let ultimaRequisicaoRecebida: { headers: Record<string, string>; body: string } | undefined;
  let statusASimular = 200;

  // Desvio do plano (documentado): a versão literal deste teste no plano de
  // execução (Task 5 Step 3) construía o campo `event.id` como uma string
  // arbitrária (ex. 'evt-svc-0001'), mas webhook_delivery.event_id é `uuid
  // NOT NULL` com FK composta (tenant_id, event_id) REFERENCES outbox_event
  // (tenant_id, id) -- design spec decisão 9, migration platform_0007. Uma
  // string não-UUID falha imediatamente com "invalid input syntax for type
  // uuid" no INSERT feito por attemptDelivery. Corrigido inserindo um
  // outbox_event real (mesmo padrão já usado pelos testes das Tasks 6/8/9) e
  // usando o id gerado -- prova, inclusive, que a FK está corretamente
  // aplicada (não seria possível gravar webhook_delivery para um evento que
  // não existe de verdade em outbox_event).
  async function criarOutboxEventReal(payload: Record<string, unknown> = {}): Promise<{ id: string; occurredAt: Date }> {
    const row = await adminPool.query<{ id: string; occurred_at: Date }>(
      `INSERT INTO outbox_event (tenant_id, aggregate_type, aggregate_id, event_type, sequence, payload, occurred_at)
       VALUES ($1, 'gate_teste', gen_random_uuid(), 'gate.evento', 1, $2::jsonb, now()) RETURNING id, occurred_at`,
      [tenantId, JSON.stringify(payload)],
    );
    return { id: row.rows[0].id, occurredAt: row.rows[0].occurred_at };
  }

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Webhook Delivery Service Ltda','00000000000155','test-tenant-00000000000155') RETURNING id`,
    );
    tenantId = t.rows[0].id;

    server = createServer((req, res) => {
      let corpo = '';
      req.on('data', (chunk) => (corpo += chunk));
      req.on('end', () => {
        ultimaRequisicaoRecebida = { headers: req.headers as Record<string, string>, body: corpo };
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
  });

  it('entrega com sucesso (2xx) grava status_http correto, sem próxima tentativa, e limpa a falha em aberto', async () => {
    statusASimular = 200;
    const endpoint = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: `https://127.0.0.1:${serverPort}`.replace('https', 'http'), eventosFiltro: ['gate.evento'] }),
    );

    const row = await adminPool.query(`SELECT segredo_atual_cifrado, segredos_historico_cifrados FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
    const outboxEvent = await criarOutboxEventReal({ x: 1 });

    const { sucesso } = await tenantContext.run(tenantId, (client) =>
      deliveryService.attemptDelivery(client, {
        tenantId,
        webhookEndpoint: {
          id: endpoint.id,
          url: `http://127.0.0.1:${serverPort}`,
          segredoAtualCifrado: row.rows[0].segredo_atual_cifrado,
          segredosHistoricoCifrados: row.rows[0].segredos_historico_cifrados,
        },
        event: { id: outboxEvent.id, eventType: 'gate.evento', sequence: 1, occurredAt: outboxEvent.occurredAt, payload: { x: 1 } },
        tentativaNum: 1,
      }),
    );

    expect(sucesso).toBe(true);
    expect(ultimaRequisicaoRecebida?.headers['x-webhook-id']).toBe(outboxEvent.id);
    expect(ultimaRequisicaoRecebida?.headers['x-signature']).toMatch(/^v1,/);

    const gravado = await adminPool.query(`SELECT status_http, proxima_tentativa_em FROM webhook_delivery WHERE webhook_endpoint_id = $1 AND event_id = $2`, [endpoint.id, outboxEvent.id]);
    expect(gravado.rows[0].status_http).toBe(200);
    expect(gravado.rows[0].proxima_tentativa_em).toBeNull();

    const endpointRow = await adminPool.query(`SELECT primeira_falha_desde_ultimo_sucesso_em FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
    expect(endpointRow.rows[0].primeira_falha_desde_ultimo_sucesso_em).toBeNull();
  });

  it('entrega falha (500) agenda proxima_tentativa_em conforme RETRY_SCHEDULE_MS e seta a falha em aberto só na primeira falha', async () => {
    statusASimular = 500;
    const endpoint = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: `http://127.0.0.1:${serverPort}`, eventosFiltro: ['gate.evento'] }),
    );
    const row = await adminPool.query(`SELECT segredo_atual_cifrado, segredos_historico_cifrados FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
    const outboxEvent = await criarOutboxEventReal();
    const evento = { id: outboxEvent.id, eventType: 'gate.evento', sequence: 1, occurredAt: outboxEvent.occurredAt, payload: {} };
    const endpointForDelivery = {
      id: endpoint.id,
      url: `http://127.0.0.1:${serverPort}`,
      segredoAtualCifrado: row.rows[0].segredo_atual_cifrado,
      segredosHistoricoCifrados: row.rows[0].segredos_historico_cifrados,
    };

    const antes = Date.now();
    const { sucesso } = await tenantContext.run(tenantId, (client) =>
      deliveryService.attemptDelivery(client, { tenantId, webhookEndpoint: endpointForDelivery, event: evento, tentativaNum: 1 }),
    );
    expect(sucesso).toBe(false);

    const gravado1 = await adminPool.query(`SELECT proxima_tentativa_em FROM webhook_delivery WHERE webhook_endpoint_id = $1 AND event_id = $2`, [endpoint.id, evento.id]);
    const proximaMs = new Date(gravado1.rows[0].proxima_tentativa_em).getTime() - antes;
    expect(proximaMs).toBeGreaterThanOrEqual(4500);
    expect(proximaMs).toBeLessThan(6000);

    const endpointRow1 = await adminPool.query(`SELECT primeira_falha_desde_ultimo_sucesso_em FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
    const primeiraFalha = endpointRow1.rows[0].primeira_falha_desde_ultimo_sucesso_em;
    expect(primeiraFalha).not.toBeNull();

    await tenantContext.run(tenantId, (client) =>
      deliveryService.attemptDelivery(client, { tenantId, webhookEndpoint: endpointForDelivery, event: evento, tentativaNum: 2 }),
    );
    const endpointRow2 = await adminPool.query(`SELECT primeira_falha_desde_ultimo_sucesso_em FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
    expect(endpointRow2.rows[0].primeira_falha_desde_ultimo_sucesso_em).toEqual(primeiraFalha);
  });

  it('tentativa 8 falhando não agenda próxima (terminal)', async () => {
    statusASimular = 500;
    const endpoint = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: `http://127.0.0.1:${serverPort}`, eventosFiltro: ['gate.evento'] }),
    );
    const row = await adminPool.query(`SELECT segredo_atual_cifrado, segredos_historico_cifrados FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
    const outboxEvent = await criarOutboxEventReal();
    const evento = { id: outboxEvent.id, eventType: 'gate.evento', sequence: 1, occurredAt: outboxEvent.occurredAt, payload: {} };

    await tenantContext.run(tenantId, (client) =>
      deliveryService.attemptDelivery(client, {
        tenantId,
        webhookEndpoint: { id: endpoint.id, url: `http://127.0.0.1:${serverPort}`, segredoAtualCifrado: row.rows[0].segredo_atual_cifrado, segredosHistoricoCifrados: row.rows[0].segredos_historico_cifrados },
        event: evento,
        tentativaNum: 8,
      }),
    );
    const gravado = await adminPool.query(`SELECT proxima_tentativa_em FROM webhook_delivery WHERE webhook_endpoint_id = $1 AND event_id = $2`, [endpoint.id, evento.id]);
    expect(gravado.rows[0].proxima_tentativa_em).toBeNull();
  });

  it('agendarProximaTentativa: false nunca agenda, mesmo falhando', async () => {
    statusASimular = 500;
    const endpoint = await tenantContext.run(tenantId, (client) =>
      endpointService.create(client, { tenantId, url: `http://127.0.0.1:${serverPort}`, eventosFiltro: ['gate.evento'] }),
    );
    const row = await adminPool.query(`SELECT segredo_atual_cifrado, segredos_historico_cifrados FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
    const outboxEvent = await criarOutboxEventReal();
    const evento = { id: outboxEvent.id, eventType: 'gate.evento', sequence: 1, occurredAt: outboxEvent.occurredAt, payload: {} };

    await tenantContext.run(tenantId, (client) =>
      deliveryService.attemptDelivery(client, {
        tenantId,
        webhookEndpoint: { id: endpoint.id, url: `http://127.0.0.1:${serverPort}`, segredoAtualCifrado: row.rows[0].segredo_atual_cifrado, segredosHistoricoCifrados: row.rows[0].segredos_historico_cifrados },
        event: evento,
        tentativaNum: 1,
        agendarProximaTentativa: false,
      }),
    );
    const gravado = await adminPool.query(`SELECT proxima_tentativa_em FROM webhook_delivery WHERE webhook_endpoint_id = $1 AND event_id = $2`, [endpoint.id, evento.id]);
    expect(gravado.rows[0].proxima_tentativa_em).toBeNull();
  });
});

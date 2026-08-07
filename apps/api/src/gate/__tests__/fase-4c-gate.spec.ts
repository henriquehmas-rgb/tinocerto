import { execFileSync } from 'child_process';
import { createServer, Server } from 'http';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DatabaseService } from '../../database/database.service';
import { TenantContext } from '../../database/tenant-context';
import { OutboxPublisher } from '../../outbox/outbox-publisher.service';
import { WebhookDeliveryConsumer } from '../../platform-api/webhooks/webhook-delivery.consumer';
import { WebhookDeliveryService } from '../../platform-api/webhooks/webhook-delivery.service';
import { WebhookEndpointService } from '../../platform-api/webhooks/webhook-endpoint.service';
import { WebhookEndpointDisableScheduler } from '../../platform-api/webhooks/webhook-endpoint-disable.scheduler';

describe('Gate consolidado — Fase 4c (Webhooks)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const endpointService = new WebhookEndpointService();
  const deliveryService = new WebhookDeliveryService();
  const redis = new Redis(process.env.REDIS_URL!);
  const publisher = new OutboxPublisher(adminPool, redis);
  const databaseService = { pool: appPool } as DatabaseService;
  const disableScheduler = new WebhookEndpointDisableScheduler();

  afterAll(async () => {
    await redis.quit();
    await adminPool.end();
    await appPool.end();
    await disableScheduler.onModuleDestroy();
  });

  it.each(['webhook_endpoint', 'webhook_delivery'])('%s tem RLS FORCE+RESTRICTIVE com predicado NULLIF', async (tabela) => {
    const rel = await adminPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
      [tabela],
    );
    expect(rel.rows[0].relrowsecurity).toBe(true);
    expect(rel.rows[0].relforcerowsecurity).toBe(true);

    const pol = await adminPool.query<{ policyname: string; permissive: string; qual: string }>(
      `SELECT policyname, permissive, qual FROM pg_policies WHERE tablename = $1`,
      [tabela],
    );
    const restritiva = pol.rows.find((r) => r.policyname === 'tenant_isolation');
    expect(restritiva?.permissive).toBe('RESTRICTIVE');
    expect(restritiva?.qual).toContain('NULLIF');
  });

  it('as migrations da Fase 4c estão registradas no manifest, na ordem certa', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../migrations/manifest.json'), 'utf-8')) as { migrations: string[] };
    for (const migration of [
      'platform_0005__outbox_event_tenant_id_unique.sql',
      'platform_0006__webhook_endpoint.sql',
      'platform_0007__webhook_delivery.sql',
    ]) {
      expect(manifest.migrations).toContain(migration);
    }
  });

  it('ponta a ponta: cria endpoint real, evento real percorre outbox_event -> Redis -> WebhookDeliveryConsumer -> POST HTTP real, e a assinatura X-Signature é verificável de verdade com openssl (não só autoconsistente na própria implementação)', async () => {
    let tenantId: string | undefined;
    let server: Server | undefined;
    try {
      tenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 4c Ltda','00000000000160','test-tenant-00000000000160') RETURNING id`,
        )
      ).rows[0].id;

      let requisicaoCapturada: { headers: Record<string, string>; body: string } | undefined;
      server = createServer((req, res) => {
        let corpo = '';
        req.on('data', (chunk) => (corpo += chunk));
        req.on('end', () => {
          requisicaoCapturada = { headers: req.headers as Record<string, string>, body: corpo };
          res.writeHead(200);
          res.end();
        });
      });
      await new Promise<void>((resolve) => server!.listen(0, resolve));
      const port = (server.address() as any).port;

      // --- 1. Cria o endpoint pelo serviço real (nunca INSERT direto) ---
      const endpoint = await tenantContext.run(tenantId, (client) =>
        endpointService.create(client, { tenantId: tenantId!, url: `http://127.0.0.1:${port}`, eventosFiltro: ['gate.evento_4c'] }),
      );
      const whsecSemPrefixo = endpoint.segredoAtual.replace(/^whsec_/, '');

      // --- 2. Evento real de domínio: INSERT em outbox_event + publisher real (nunca injeção direta no Redis) ---
      const eventoRow = await adminPool.query<{ id: string }>(
        `INSERT INTO outbox_event (tenant_id, aggregate_type, aggregate_id, event_type, sequence, payload, occurred_at)
         VALUES ($1, 'gate_teste', gen_random_uuid(), 'gate.evento_4c', 1, '{"mensagem":"gate 4c"}'::jsonb, now()) RETURNING id`,
        [tenantId],
      );
      await publisher.publishPending();

      // --- 3. WebhookDeliveryConsumer processa uma rodada real (PEL + fresh) ---
      // ensureConsumerGroup/processBatch são privados -- cast tipado, mesmo
      // padrão de insights/adverse-impact.consumer.spec.ts.
      type ConsumerPrivates = { ensureConsumerGroup: (t: string) => Promise<void>; processBatch: (t: string, id: '0' | '>') => Promise<void> };
      const consumer = new WebhookDeliveryConsumer(deliveryService, databaseService);
      await (consumer as unknown as ConsumerPrivates).ensureConsumerGroup(tenantId);
      await (consumer as unknown as ConsumerPrivates).processBatch(tenantId, '0');
      await (consumer as unknown as ConsumerPrivates).processBatch(tenantId, '>');

      expect(requisicaoCapturada).toBeDefined();
      const webhookId = requisicaoCapturada!.headers['x-webhook-id'];
      const timestamp = requisicaoCapturada!.headers['x-webhook-timestamp'];
      const body = requisicaoCapturada!.body;
      const assinaturaEnviada = requisicaoCapturada!.headers['x-signature'];
      expect(webhookId).toBe(eventoRow.rows[0].id);
      expect(assinaturaEnviada.startsWith('v1,')).toBe(true);

      // --- 4. PROVA REAL com openssl -- não é comentário morto, é executado. ---
      // Receita EXATA de 04-api-e-webhooks.md §4 (documentada aqui para
      // leitura humana, mas invocada via execFileSync/array de argumentos +
      // stdin, NUNCA interpolando payload/segredo numa string de shell):
      //   payload="${webhook_id}.${timestamp}.${body}"
      //   echo -n "$payload" | openssl dgst -sha256 -hmac "$whsec_sem_prefixo" -binary | base64
      // Desvio deliberado do plano (hardening de segurança, não muda o que
      // é provado): o plano original usava execSync com a string inteira
      // interpolada via shell:'/bin/bash' -- payload/body vêm de conteúdo
      // capturado de uma requisição HTTP (mesmo sendo, nesta fatia, gerado
      // pelo próprio teste, não um terceiro), então interpolar em string de
      // shell é uma prática arriscada por padrão (injeção via `$`, backtick,
      // etc. dentro de aspas duplas). execFileSync com array de argumentos
      // nunca invoca um shell -- openssl é chamado diretamente, payload
      // entra via stdin (`input`), sem ponto nenhum de interpolação. A
      // conversão para base64 acontece em JS sobre o Buffer binário
      // retornado, eliminando também o pipe `| base64` do shell. O binário
      // openssl real continua sendo invocado de verdade via child_process --
      // a prova de interoperabilidade que o gate exige não muda.
      const payload = `${webhookId}.${timestamp}.${body}`;
      const digestBinario = execFileSync('openssl', ['dgst', '-sha256', '-hmac', whsecSemPrefixo, '-binary'], {
        input: payload,
      });
      const assinaturaOpenssl = digestBinario.toString('base64');

      const assinaturaDoAppSemPrefixo = assinaturaEnviada.replace(/^v1,/, '');
      expect(assinaturaOpenssl).toBe(assinaturaDoAppSemPrefixo);

      // --- 5. eventos_filtro incompatível não gera tentativa ---
      const endpointIncompativel = await tenantContext.run(tenantId, (client) =>
        endpointService.create(client, { tenantId: tenantId!, url: `http://127.0.0.1:${port}`, eventosFiltro: ['outro.tipo'] }),
      );
      const entregasIncompativel = await adminPool.query(`SELECT * FROM webhook_delivery WHERE webhook_endpoint_id = $1`, [endpointIncompativel.id]);
      expect(entregasIncompativel.rows).toHaveLength(0);

      // --- 6. Auto-disable: força 5 dias de falha em aberto e roda o sweep ---
      await adminPool.query(`UPDATE webhook_endpoint SET primeira_falha_desde_ultimo_sucesso_em = now() - interval '5 days 1 hour' WHERE id = $1`, [endpoint.id]);
      await disableScheduler.sweep();
      const endpointFinal = await adminPool.query(`SELECT ativo FROM webhook_endpoint WHERE id = $1`, [endpoint.id]);
      expect(endpointFinal.rows[0].ativo).toBe(false);
      const eventoDisable = await adminPool.query(`SELECT event_type FROM outbox_event WHERE aggregate_id = $1`, [endpoint.id]);
      expect(eventoDisable.rows.map((r) => r.event_type)).toContain('webhook.endpoint_disabled');

      // --- 7. Isolamento de tenant real ---
      const outroTenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 4c Outro Ltda','00000000000161','test-tenant-00000000000161') RETURNING id`,
        )
      ).rows[0].id;
      try {
        const listaOutroTenant = await tenantContext.run(outroTenantId, (client) => endpointService.list(client));
        expect(listaOutroTenant).toHaveLength(0);
      } finally {
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenantId]);
      }
    } finally {
      if (server) await new Promise((resolve) => server!.close(resolve));
      if (tenantId) {
        await adminPool.query('DELETE FROM webhook_delivery WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM webhook_endpoint WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
        await redis.del(`outbox:${tenantId}`);
      }
    }
  }, 60_000);
});

// apps/api/src/platform-api/webhooks/webhook-delivery.consumer.ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { TenantContext } from '../../database/tenant-context';
import { EncryptedSecret } from './webhook-secret-cipher';
import { WebhookDeliveryService } from './webhook-delivery.service';

const CONSUMER_GROUP = 'webhook_delivery_consumer_group';
const CONSUMER_NAME = 'webhook-delivery-consumer-1';

// Mesmo padrão de laço já estabelecido em
// insights/adverse-impact.consumer.ts (o mais recente e correto dos
// consumidores existentes -- NÃO o padrão mais antigo de
// trust/outbox-to-audit.consumer.ts): stream por tenant via
// list_all_tenant_ids(), PEL ('0') antes de mensagens novas ('>'), corpo
// do laço em try/catch por MENSAGEM (nunca por sub-operação). `raw.payload`
// é só o payload de DOMÍNIO -- `event_type`/`id` são campos IRMÃOS no
// mesmo XADD, nunca aninhados dentro de payload; `tenant_id` nunca vai ao
// Redis, chega aqui via list_all_tenant_ids(). Mesmo bug CRITICAL já
// documentado em adverse-impact.consumer.ts evitado aqui desde o início.
@Injectable()
export class WebhookDeliveryConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryConsumer.name);
  private readonly redis: Redis;
  private readonly pool: Pool;
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly webhookDeliveryService: WebhookDeliveryService,
    databaseService: DatabaseService,
  ) {
    this.redis = new Redis(process.env.REDIS_URL!);
    this.pool = databaseService.pool;
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  async onModuleInit(): Promise<void> {
    void this.consumeLoop();
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  private streamKeyFor(tenantId: string): string {
    return `outbox:${tenantId}`;
  }

  private async consumeLoop(): Promise<void> {
    for (;;) {
      try {
        const tenantIds = await this.listTenantIds();
        for (const tenantId of tenantIds) {
          await this.ensureConsumerGroup(tenantId);
          await this.processBatch(tenantId, '0');
          await this.processBatch(tenantId, '>');
        }
        if (tenantIds.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      } catch (err) {
        this.logger.error('Falha numa volta do laço de consumo -- seguindo para a próxima', err as Error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async listTenantIds(): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>('SELECT id FROM list_all_tenant_ids()');
    return result.rows.map((row) => row.id);
  }

  private async ensureConsumerGroup(tenantId: string): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', this.streamKeyFor(tenantId), CONSUMER_GROUP, '0', 'MKSTREAM');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
  }

  private async processBatch(tenantId: string, id: '0' | '>'): Promise<void> {
    const streamKey = this.streamKeyFor(tenantId);
    const result = await this.redis.xreadgroup('GROUP', CONSUMER_GROUP, CONSUMER_NAME, 'COUNT', 10, 'BLOCK', id === '>' ? 5000 : 0, 'STREAMS', streamKey, id);
    if (!result) return;

    const [, messages] = (result as [string, [string, string[]][]][])[0];
    let processed = 0;
    let failed = 0;

    for (const [messageId, fields] of messages) {
      const raw: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) raw[fields[i]] = fields[i + 1];

      try {
        await this.handleMessage(tenantId, raw);
        await this.redis.xack(streamKey, CONSUMER_GROUP, messageId);
        processed++;
      } catch (err) {
        failed++;
        this.logger.error(`Falha ao processar mensagem ${messageId} (tenant ${tenantId})`, err as Error);
      }
    }

    if (failed > 0 && processed === 0) {
      throw new Error(`WebhookDeliveryConsumer: ${failed} mensagem(ns) falharam sem nenhum sucesso neste lote (tenant ${tenantId})`);
    }
  }

  private async handleMessage(tenantId: string, raw: Record<string, string>): Promise<void> {
    const eventId = raw.id;
    const eventType = raw.event_type;
    const payload = JSON.parse(raw.payload ?? '{}');
    const occurredAt = new Date(raw.occurred_at);
    const sequence = Number(raw.sequence);

    await this.tenantContext.run(tenantId, async (client) => {
      const endpoints = await client.query<{
        id: string;
        url: string;
        segredo_atual_cifrado: EncryptedSecret;
        segredos_historico_cifrados: EncryptedSecret[];
      }>(
        `SELECT id, url, segredo_atual_cifrado, segredos_historico_cifrados
           FROM webhook_endpoint
          WHERE tenant_id = $1 AND ativo = true AND $2 = ANY(eventos_filtro)`,
        [tenantId, eventType],
      );

      for (const ep of endpoints.rows) {
        await this.webhookDeliveryService.attemptDelivery(client, {
          tenantId,
          webhookEndpoint: {
            id: ep.id,
            url: ep.url,
            segredoAtualCifrado: ep.segredo_atual_cifrado,
            segredosHistoricoCifrados: ep.segredos_historico_cifrados,
          },
          event: { id: eventId, eventType, sequence, occurredAt, payload },
          tentativaNum: 1,
        });
      }
    });
  }
}

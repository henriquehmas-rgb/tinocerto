// apps/api/src/platform-api/webhooks/webhook-retry.scheduler.ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { EncryptedSecret } from './webhook-secret-cipher';
import { WebhookDeliveryService } from './webhook-delivery.service';

const POLL_INTERVAL_MS = 5_000;

// Poller Postgres puro -- NUNCA volta a tocar o Redis. Cada retentativa
// reconstrói o envelope exclusivamente a partir de outbox_event (imutável,
// já durável desde a escrita original), então o corpo assinado é
// byte-idêntico em toda tentativa da mesma entrega. Pool próprio direto de
// DATABASE_URL -- mesma exceção documentada em OutboxPublishingScheduler
// (Task 1): a consulta de candidatos precisa enxergar todos os tenants.
@Injectable()
export class WebhookRetryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRetryScheduler.name);
  private readonly adminPool: Pool;
  private readonly tenantContext: TenantContext;
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(private readonly webhookDeliveryService: WebhookDeliveryService) {
    this.adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    this.tenantContext = new TenantContext(this.adminPool);
  }

  async onModuleInit(): Promise<void> {
    this.scheduleNext();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.adminPool.end();
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    try {
      await this.processDueRetries();
    } catch (err) {
      this.logger.error('Falha numa rodada do WebhookRetryScheduler -- seguindo para a próxima', err as Error);
    } finally {
      this.scheduleNext();
    }
  }

  async processDueRetries(): Promise<void> {
    // Só a tentativa MAIS RECENTE de cada par (endpoint, evento) importa --
    // DISTINCT ON evita agir sobre uma linha antiga já superada.
    const candidatos = await this.adminPool.query<{
      tenant_id: string; webhook_endpoint_id: string; event_id: string; tentativa_num: number;
    }>(
      `SELECT DISTINCT ON (webhook_endpoint_id, event_id) tenant_id, webhook_endpoint_id, event_id, tentativa_num
         FROM webhook_delivery
        WHERE proxima_tentativa_em IS NOT NULL AND proxima_tentativa_em <= now()
        ORDER BY webhook_endpoint_id, event_id, tentativa_num DESC
        LIMIT 50`,
    );

    for (const row of candidatos.rows) {
      try {
        await this.retryOne(row);
      } catch (err) {
        this.logger.error(`Falha ao retentar entrega (endpoint ${row.webhook_endpoint_id}, evento ${row.event_id})`, err as Error);
      }
    }
  }

  private async retryOne(row: { tenant_id: string; webhook_endpoint_id: string; event_id: string; tentativa_num: number }): Promise<void> {
    await this.tenantContext.run(row.tenant_id, async (client) => {
      const endpointRow = await client.query<{ id: string; url: string; ativo: boolean; segredo_atual_cifrado: EncryptedSecret; segredos_historico_cifrados: EncryptedSecret[] }>(
        `SELECT id, url, ativo, segredo_atual_cifrado, segredos_historico_cifrados FROM webhook_endpoint WHERE id = $1`,
        [row.webhook_endpoint_id],
      );
      if (endpointRow.rows.length === 0 || !endpointRow.rows[0].ativo) return; // endpoint desativado desde então -- não retenta

      const eventRow = await client.query<{ id: string; event_type: string; sequence: string; occurred_at: Date; payload: Record<string, unknown> }>(
        `SELECT id, event_type, sequence, occurred_at, payload FROM outbox_event WHERE id = $1`,
        [row.event_id],
      );
      if (eventRow.rows.length === 0) return;

      await this.webhookDeliveryService.attemptDelivery(client, {
        tenantId: row.tenant_id,
        webhookEndpoint: {
          id: endpointRow.rows[0].id,
          url: endpointRow.rows[0].url,
          segredoAtualCifrado: endpointRow.rows[0].segredo_atual_cifrado,
          segredosHistoricoCifrados: endpointRow.rows[0].segredos_historico_cifrados,
        },
        event: {
          id: eventRow.rows[0].id,
          eventType: eventRow.rows[0].event_type,
          sequence: Number(eventRow.rows[0].sequence),
          occurredAt: eventRow.rows[0].occurred_at,
          payload: eventRow.rows[0].payload,
        },
        tentativaNum: row.tentativa_num + 1,
      });
    });
  }
}

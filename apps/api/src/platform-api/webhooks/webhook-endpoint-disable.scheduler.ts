// apps/api/src/platform-api/webhooks/webhook-endpoint-disable.scheduler.ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { OutboxService } from '../../outbox/outbox.service';
import { nextOutboxSequence } from '../../outbox/next-outbox-sequence';

const SWEEP_INTERVAL_MS = 60_000; // não é sensível a segundos -- 5 dias de janela

// Critério de pronto do roadmap (07-roadmap-por-fases.md §6): "Um webhook
// endpoint que falha 100% por 5 dias consecutivos é desativado
// automaticamente e dispara webhook.endpoint_disabled -- nunca
// silenciosamente." primeira_falha_desde_ultimo_sucesso_em (setado por
// WebhookDeliveryService, limpo em qualquer sucesso) é o marcador --
// "5 dias consecutivos de falha" = 5 dias desde essa marca sem nenhum
// sucesso ter zerado ela no meio do caminho.
@Injectable()
export class WebhookEndpointDisableScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookEndpointDisableScheduler.name);
  private readonly adminPool: Pool;
  private readonly tenantContext: TenantContext;
  private readonly outboxService = new OutboxService();
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor() {
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
    this.timer = setTimeout(() => void this.tick(), SWEEP_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error('Falha numa rodada do sweep de auto-disable -- seguindo para a próxima', err as Error);
    } finally {
      this.scheduleNext();
    }
  }

  async sweep(): Promise<void> {
    const candidatos = await this.adminPool.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM webhook_endpoint
        WHERE ativo = true
          AND primeira_falha_desde_ultimo_sucesso_em IS NOT NULL
          AND now() - primeira_falha_desde_ultimo_sucesso_em >= interval '5 days'`,
    );

    for (const row of candidatos.rows) {
      try {
        await this.disableOne(row);
      } catch (err) {
        this.logger.error(`Falha ao desativar endpoint ${row.id}`, err as Error);
      }
    }
  }

  private async disableOne(row: { id: string; tenant_id: string }): Promise<void> {
    await this.tenantContext.run(row.tenant_id, async (client) => {
      await client.query(`UPDATE webhook_endpoint SET ativo = false WHERE id = $1`, [row.id]);
      const sequence = await nextOutboxSequence(client, row.id);
      await this.outboxService.write(client, {
        tenantId: row.tenant_id,
        aggregateType: 'webhook_endpoint',
        aggregateId: row.id,
        eventType: 'webhook.endpoint_disabled',
        sequence,
        payload: { webhook_endpoint_id: row.id },
        occurredAt: new Date(),
      });
    });
  }
}

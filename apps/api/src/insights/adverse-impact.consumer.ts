import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { TenantContext } from '../database/tenant-context';
import { AdverseImpactSnapshotService } from './adverse-impact-snapshot.service';

const CONSUMER_GROUP = 'adverse_impact_consumer_group';
const CONSUMER_NAME = 'adverse-impact-consumer-1';
const RELEVANT_EVENT_TYPES = ['application.created', 'application.stage_changed', 'application.rejected'] as const;

export interface DomainEvent {
  eventType: (typeof RELEVANT_EVENT_TYPES)[number];
  tenantId: string;
  payload: Record<string, unknown>;
}

// Mesmo padrão de laço já estabelecido em
// resume/candidate-application-summary.consumer.ts: stream por tenant,
// PEL ('0') antes de mensagens novas ('>'), corpo do laço em try/catch
// para nunca derrubar o processo Node inteiro por uma exceção de uma
// única mensagem. `pool`/`tenantContext` vêm de `DatabaseService`
// injetado via DI (`@Global()`, mesmo provider que todo controller do
// projeto usa) -- `TenantContext` é construído manualmente no
// construtor, nunca via DI, porque NENHUM lugar do projeto registra
// `TenantContext` como provider (ver JobController/AdherenceController):
// é sempre `new TenantContext(databaseService.pool)` dentro do
// construtor de quem precisa dele. Este consumidor segue exatamente o
// mesmo padrão, não introduz um novo.
@Injectable()
export class AdverseImpactConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdverseImpactConsumer.name);
  private readonly redis: Redis;
  private readonly pool: Pool;
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly snapshotService: AdverseImpactSnapshotService,
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
        this.logger.error('Falha numa volta do laço de consumo -- seguindo para a próxima em vez de derrubar o processo', err as Error);
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
    const result = await this.redis.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'COUNT', 10,
      'BLOCK', id === '>' ? 5000 : 0,
      'STREAMS', streamKey, id,
    );
    if (!result) return;

    const [, messages] = (result as [string, [string, string[]][]][])[0];
    let processed = 0;
    let failed = 0;

    for (const [messageId, fields] of messages) {
      const raw: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) raw[fields[i]] = fields[i + 1];
      const event = JSON.parse(raw.payload ?? '{}');

      if (!RELEVANT_EVENT_TYPES.includes(event.event_type)) {
        await this.redis.xack(streamKey, CONSUMER_GROUP, messageId);
        continue;
      }

      try {
        await this.handleEvent({ eventType: event.event_type, tenantId: event.tenant_id, payload: event.payload });
        await this.redis.xack(streamKey, CONSUMER_GROUP, messageId);
        processed++;
      } catch (err) {
        failed++;
        this.logger.error(`Falha ao processar mensagem ${messageId} (tenant ${tenantId})`, err as Error);
      }
    }

    if (failed > 0 && processed === 0) {
      throw new Error(`AdverseImpactConsumer: ${failed} mensagem(ns) falharam sem nenhum sucesso neste lote (tenant ${tenantId})`);
    }
  }

  /**
   * `application.created` traz `job_id` no próprio payload; os outros dois
   * eventos não -- resolve via lookup em `application`, dentro do mesmo
   * TenantContext, então sob RLS de verdade. Candidatura que já não existe
   * (ou não é deste tenant) simplesmente não recalcula nada -- não é erro.
   */
  async handleEvent(event: DomainEvent): Promise<void> {
    const applicationId = event.payload.application_id as string;

    await this.tenantContext.run(event.tenantId, async (client) => {
      let jobId: string;
      if (event.eventType === 'application.created') {
        jobId = event.payload.job_id as string;
      } else {
        const result = await client.query<{ job_id: string }>(`SELECT job_id FROM application WHERE id = $1`, [applicationId]);
        if (result.rows.length === 0) return;
        jobId = result.rows[0].job_id;
      }
      await this.snapshotService.recompute(client, event.tenantId, jobId);
    });
  }
}

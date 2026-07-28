import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';

const CONSUMER_GROUP = 'candidate_application_summary_consumer_group';
const CONSUMER_NAME = 'candidate-application-summary-consumer-1';
const RELEVANT_EVENT_TYPES = ['application.created', 'application.stage_changed', 'application.rejected'] as const;

export interface DomainEvent {
  eventType: (typeof RELEVANT_EVENT_TYPES)[number];
  tenantId: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class CandidateApplicationSummaryConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CandidateApplicationSummaryConsumer.name);
  private readonly redis: Redis;
  // Mesma stream que OutboxPublisher (Fase 0) escreve -- ver nota da Task 13.
  private readonly streamKey = process.env.OUTBOX_STREAM_KEY ?? 'outbox_event_stream';

  constructor(private readonly pool: Pool) {
    this.redis = new Redis(process.env.REDIS_URL!);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', this.streamKey, CONSUMER_GROUP, '0', 'MKSTREAM');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
    void this.consumeLoop();
  }

  // [Desvio do plano, mesmo padrão aplicado ao ResumeParsingConsumer na
  // Task 13] A conexão ioredis é aberta no construtor e precisa ser
  // fechada explicitamente -- sem isso, qualquer processo que instancie
  // esta classe diretamente (incluindo os testes deste arquivo, que
  // chamam `new CandidateApplicationSummaryConsumer(...)` sem passar pelo
  // ciclo de vida do Nest) fica com uma conexão TCP viva mantendo o event
  // loop ativo indefinidamente após o trabalho terminar -- reproduzido ao
  // vivo ao rodar este spec sem este hook. Quando registrado como
  // provider via Nest DI (`ResumeModule`, Step 12 desta task), o Nest
  // chama este hook automaticamente em app.close()/shutdown.
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  private async consumeLoop(): Promise<void> {
    for (;;) {
      await this.processBatch('0');
      await this.processBatch('>');
    }
  }

  private async processBatch(id: '0' | '>'): Promise<void> {
    const result = await this.redis.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'COUNT', 10,
      'BLOCK', id === '>' ? 5000 : 0,
      'STREAMS', this.streamKey, id,
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
        await this.redis.xack(this.streamKey, CONSUMER_GROUP, messageId);
        continue;
      }

      try {
        await this.handleEvent({ eventType: event.event_type, tenantId: event.tenant_id, payload: event.payload });
        await this.redis.xack(this.streamKey, CONSUMER_GROUP, messageId);
        processed++;
      } catch (err) {
        failed++;
        this.logger.error(`Falha ao processar mensagem ${messageId}`, err as Error);
      }
    }

    if (failed > 0 && processed === 0) {
      throw new Error(`CandidateApplicationSummaryConsumer: ${failed} mensagem(ns) falharam sem nenhum sucesso neste lote`);
    }
  }

  async handleEvent(event: DomainEvent): Promise<void> {
    switch (event.eventType) {
      case 'application.created':
        await this.pool.query(
          `INSERT INTO candidate_application_summary (person_id, tenant_id, application_id, job_titulo, etapa_funil)
           VALUES ($1, $2, $3, $4, 'triagem')
           ON CONFLICT (application_id) DO NOTHING`,
          [event.payload.person_id, event.tenantId, event.payload.application_id, event.payload.job_titulo ?? ''],
        );
        break;
      case 'application.stage_changed':
        await this.pool.query(
          `UPDATE candidate_application_summary SET etapa_funil = $1, atualizado_em = now() WHERE application_id = $2`,
          [event.payload.to_state, event.payload.application_id],
        );
        break;
      case 'application.rejected':
        await this.pool.query(
          `UPDATE candidate_application_summary SET reprovado_em = now(), atualizado_em = now() WHERE application_id = $1`,
          [event.payload.application_id],
        );
        break;
    }
  }
}

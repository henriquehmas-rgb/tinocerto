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

  constructor(private readonly pool: Pool) {
    this.redis = new Redis(process.env.REDIS_URL!);
  }

  async onModuleInit(): Promise<void> {
    void this.consumeLoop();
  }

  // A conexão ioredis é aberta no construtor (acima) e precisa ser fechada
  // explicitamente -- sem isso, qualquer processo que instancie esta classe
  // diretamente (incluindo os testes deste arquivo, que chamam
  // `new CandidateApplicationSummaryConsumer(...)` sem passar pelo ciclo de
  // vida do Nest) fica com uma conexão TCP viva mantendo o event loop ativo
  // indefinidamente após o trabalho terminar. Quando registrado como
  // provider via Nest DI (`ResumeModule`), o Nest chama este hook
  // automaticamente em app.close()/shutdown.
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  // [Fix round 1, achado #1 do revisor independente] A implementação
  // original assumia uma única stream global (`OUTBOX_STREAM_KEY` /
  // 'outbox_event_stream'). É exatamente o mesmo engano já cometido e
  // corrigido no ResumeParsingConsumer (Task 13, commit 8f8fc2c) -- ver o
  // comentário longo naquele arquivo. OutboxPublisher
  // (apps/api/src/outbox/outbox-publisher.service.ts) escreve em UMA
  // STREAM POR TENANT (`outbox:{tenant_id}`), nunca em
  // 'outbox_event_stream'. Apontar para essa constante cria (MKSTREAM) um
  // grupo de consumidor numa stream vazia -- nenhum evento
  // application.created/application.stage_changed/application.rejected
  // seria consumido, jamais, silenciosamente (candidate_application_summary
  // ficaria congelado em 'triagem' para sempre). A correção reaproveita o
  // mesmo padrão do ResumeParsingConsumer: varrer os tenants conhecidos a
  // cada volta do laço e ler a stream de cada um, PEL ('0') primeiro,
  // depois mensagens novas ('>').
  private streamKeyFor(tenantId: string): string {
    return `outbox:${tenantId}`;
  }

  private async consumeLoop(): Promise<void> {
    for (;;) {
      // [Fix round 1, achado #2 do revisor independente da Task 17]
      // Corpo inteiro envolto em try/catch: sem isso, QUALQUER exceção
      // aqui dentro (Postgres, Redis, ou -- caso concreto reproduzido ao
      // vivo -- listTenantIds() batendo numa conexão do pool com
      // app.tenant_id residual, ver comentário da migration
      // resume_0004__list_all_tenant_ids_function.sql) sobe sem ser
      // capturada a partir de `void this.consumeLoop()` (onModuleInit,
      // fire-and-forget), vira unhandled rejection e derruba o processo
      // Node inteiro -- não só esta requisição, o servidor HTTP inteiro
      // junto. Loga e segue para a próxima volta em vez de deixar isso
      // acontecer; nenhum XACK foi dado nesta iteração então nada se
      // perde -- a garantia at-least-once do outbox cobre a próxima
      // tentativa.
      try {
        const tenantIds = await this.listTenantIds();
        for (const tenantId of tenantIds) {
          await this.ensureConsumerGroup(tenantId);
          // PEL primeiro (mensagens pendentes de uma queda anterior deste
          // consumer para este tenant), só depois mensagens novas -- mesmo
          // padrão de ResumeParsingConsumer/OutboxToAuditConsumer, sem isso a
          // garantia at-least-once é falsa (bug já corrigido uma vez neste
          // projeto, Fase 0 Task 14).
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
    // [Fix round 1, achado #2 do revisor independente da Task 17] Não
    // consulta `tenant` diretamente -- ver comentário completo em
    // resume_0004__list_all_tenant_ids_function.sql sobre por que
    // `SELECT id FROM tenant` direto, rodando como app_runtime, tanto
    // podia devolver 0 linhas silenciosamente (conexão nova, GUC NULL)
    // quanto estourar 22P02 e derrubar o processo (conexão reciclada,
    // GUC revertido para '').
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

      // [Achado CRITICAL de revisão adversarial, mesmo bug corrigido em
      // insights/adverse-impact.consumer.ts commit 1d8816e] `raw.payload` é
      // só o payload de DOMÍNIO (ex.: {application_id, job_id, ...}) -- é o
      // que OutboxPublisher.publishPending grava no campo `payload` do
      // XADD, separado dos campos irmãos `event_type`/`aggregate_id`/etc.
      // no MESMO NÍVEL do registro Redis. `event_type` e `tenant_id` nunca
      // estiveram dentro do payload de domínio -- `tenant_id` nem é gravado
      // no Redis (só existe embutido na CHAVE do stream,
      // `outbox:{tenant_id}`, e chega aqui via o parâmetro `tenantId` do
      // laço, que já sabe de qual tenant está lendo). A versão anterior
      // fazia `JSON.parse(raw.payload)` e tratava o resultado (que É o
      // payload de domínio) como se fosse o envelope inteiro, lendo
      // `.event_type`/`.tenant_id`/`.payload` dele -- todos sempre
      // `undefined`. Consequência: `RELEVANT_EVENT_TYPES.includes(undefined)`
      // era sempre `false`, então TODA mensagem real era ACKed e descartada
      // como "irrelevante" antes de chegar em handleEvent, silenciosamente
      // -- o consumidor "rodava" sem nunca processar nada.
      if (!RELEVANT_EVENT_TYPES.includes(raw.event_type as (typeof RELEVANT_EVENT_TYPES)[number])) {
        await this.redis.xack(streamKey, CONSUMER_GROUP, messageId);
        continue;
      }

      try {
        const payload = JSON.parse(raw.payload ?? '{}');
        await this.handleEvent({
          eventType: raw.event_type as (typeof RELEVANT_EVENT_TYPES)[number],
          tenantId,
          payload,
        });
        await this.redis.xack(streamKey, CONSUMER_GROUP, messageId);
        processed++;
      } catch (err) {
        failed++;
        this.logger.error(`Falha ao processar mensagem ${messageId} (tenant ${tenantId})`, err as Error);
      }
    }

    if (failed > 0 && processed === 0) {
      throw new Error(`CandidateApplicationSummaryConsumer: ${failed} mensagem(ns) falharam sem nenhum sucesso neste lote (tenant ${tenantId})`);
    }
  }

  async handleEvent(event: DomainEvent): Promise<void> {
    switch (event.eventType) {
      case 'application.created':
        // [Fix round 1, achado #2 do revisor independente] O payload real
        // de application.created (apps/api/src/hiring/application.service.ts,
        // Fase 1a, inalterado por esta task) tem a chave `job_id`, nunca
        // `job_titulo` -- este consumer lia uma chave que nunca existe no
        // payload real, o que sempre resolvia para ''. Corrigido para o
        // mesmo padrão já usado no caminho síncrono
        // (public-application.service.ts, Step 7 desta task): resolver o
        // título via subquery a partir de job_id, em vez de confiar num
        // campo que o publisher de eventos nunca escreveu.
        //
        // [Fase 3d] tenant_id volta a ser gravado (resume_0006) -- agora
        // tem consumidor real (CandidateEvaluationViewService precisa
        // resolver o tenant de uma application_id sem tenant conhecido a
        // priori). event.tenantId já chegava até aqui só para resolver a
        // stream do outbox; passa a ser usado também para esta escrita.
        await this.pool.query(
          `INSERT INTO candidate_application_summary (person_id, application_id, job_titulo, etapa_funil, tenant_id)
           VALUES ($1, $2, (SELECT titulo FROM job WHERE id = $3), 'triagem', $4)
           ON CONFLICT (application_id) DO NOTHING`,
          [event.payload.person_id, event.payload.application_id, event.payload.job_id, event.tenantId],
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

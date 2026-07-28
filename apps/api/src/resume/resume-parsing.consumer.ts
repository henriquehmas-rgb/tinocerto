import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { StorageService } from '../storage/storage.service';
import { extractResumeText } from './extract-resume-text';
import { ResumeStructuringService, StructuredResume } from './resume-structuring.service';
import { locateVerbatimOffset } from './locate-verbatim-offset';

const RESUME_BUCKET = process.env.MINIO_RESUME_BUCKET ?? 'curriculos';
const CONSUMER_GROUP = 'resume_parsing_consumer_group';
const CONSUMER_NAME = 'resume-parsing-consumer-1';

export interface ResumeUploadedPayload {
  resumeUploadId: string;
  storageKey: string;
}

function withOffset<T extends { citacaoVerbatim: string }>(texto: string, item: T) {
  const offset = locateVerbatimOffset(texto, item.citacaoVerbatim);
  return { ...item, offsetInicio: offset?.offsetInicio ?? null, offsetFim: offset?.offsetFim ?? null };
}

@Injectable()
export class ResumeParsingConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResumeParsingConsumer.name);
  private readonly redis: Redis;

  constructor(
    private readonly pool: Pool,
    private readonly storageService: StorageService,
    private readonly structuringService: ResumeStructuringService,
  ) {
    this.redis = new Redis(process.env.REDIS_URL!);
  }

  async onModuleInit(): Promise<void> {
    void this.consumeLoop();
  }

  // A conexão ioredis é aberta no construtor (acima) e precisa ser fechada
  // explicitamente -- sem isso, qualquer processo que instancie esta classe
  // (incluindo testes que chamam `new ResumeParsingConsumer(...)` direto,
  // sem passar pelo ciclo de vida do Nest) fica com uma conexão TCP viva
  // mantendo o event loop ativo indefinidamente após o trabalho terminar.
  // Quando registrado como provider via Nest DI (Task 14), o Nest chama
  // este hook automaticamente em app.close()/shutdown.
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  // [Desvio do plano, verificado contra Fase 0] O plano original assumia
  // uma única stream global (`OUTBOX_STREAM_KEY` / 'outbox_event_stream').
  // Lendo apps/api/src/outbox/outbox-publisher.service.ts (Fase 0, Task 12)
  // e apps/api/src/trust/outbox-to-audit.consumer.ts (Fase 0, Task 13) --
  // como o próprio enunciado desta task instruiu antes de implementar --
  // confirma-se que não existe stream única: OutboxPublisher escreve em UMA
  // STREAM POR TENANT (`outbox:{tenant_id}`, ver outbox-publisher.service.ts
  // linha do XADD), e OutboxToAuditConsumer é instanciado por tenant
  // (recebe tenantId no construtor) e chamado uma vez por tenant pelo
  // scheduler que o invoca. 'outbox_event_stream' nunca é escrito por
  // ninguém -- se este consumer apontasse para essa constante, o grupo de
  // consumidor seria criado (MKSTREAM) numa stream vazia e nenhum evento
  // 'resume.uploaded' seria consumido, silenciosamente, para sempre.
  // Reaproveitando a stream real (ver instrução da task: "reaproveite a
  // mesma stream, não crie uma nova"), este consumer varre os tenants
  // conhecidos a cada volta do laço e lê a stream de cada um. O construtor
  // continua (pool, storageService, structuringService) -- sem tenantId --
  // porque handleResumeUploaded opera sobre recursos GLOBAIS (person,
  // resume_upload, person_profile); só a leitura do stream é per-tenant.
  private streamKeyFor(tenantId: string): string {
    return `outbox:${tenantId}`;
  }

  private async consumeLoop(): Promise<void> {
    for (;;) {
      const tenantIds = await this.listTenantIds();
      for (const tenantId of tenantIds) {
        await this.ensureConsumerGroup(tenantId);
        // PEL primeiro (mensagens pendentes de uma queda anterior deste
        // consumer para este tenant), só depois mensagens novas -- mesmo
        // padrão de OutboxToAuditConsumer (Fase 0), sem isso a garantia
        // at-least-once é falsa (bug já corrigido uma vez neste projeto).
        await this.processBatch(tenantId, '0');
        await this.processBatch(tenantId, '>');
      }
      if (tenantIds.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async listTenantIds(): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>('SELECT id FROM tenant');
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
    // BLOCK preservado do plano original (perdido na adaptação para stream
    // por tenant): '0' (PEL) não bloqueia -- mensagens pendentes, se
    // existirem, já estão lá, não há motivo para esperar. '>' (mensagens
    // novas) bloqueia até 5s -- sem isso, o laço em consumeLoop() vira
    // busy-poll assim que existir pelo menos um tenant, batendo
    // continuamente em Postgres (listTenantIds) e Redis (XREADGROUP) sem
    // nenhum intervalo.
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

      if (event.event_type !== 'resume.uploaded') {
        await this.redis.xack(streamKey, CONSUMER_GROUP, messageId);
        continue;
      }

      try {
        await this.handleResumeUploaded({
          resumeUploadId: event.payload.resume_upload_id,
          storageKey: event.payload.storage_key,
        });
        await this.redis.xack(streamKey, CONSUMER_GROUP, messageId);
        processed++;
      } catch (err) {
        failed++;
        this.logger.error(`Falha ao processar mensagem ${messageId} (tenant ${tenantId})`, err as Error);
      }
    }

    if (failed > 0 && processed === 0) {
      throw new Error(`ResumeParsingConsumer: ${failed} mensagem(ns) falharam sem nenhum sucesso neste lote (tenant ${tenantId})`);
    }
  }

  async handleResumeUploaded(payload: ResumeUploadedPayload): Promise<void> {
    try {
      const buffer = await this.storageService.download(RESUME_BUCKET, payload.storageKey);
      const texto = await extractResumeText(buffer);
      const estruturado: StructuredResume = await this.structuringService.structure(texto);

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        const uploadRow = await client.query<{ person_id: string }>(
          `UPDATE resume_upload SET texto_extraido = $1, status = 'processado' WHERE id = $2 RETURNING person_id`,
          [texto, payload.resumeUploadId],
        );
        if (uploadRow.rows.length === 0) {
          throw new Error(`resume_upload ${payload.resumeUploadId} não encontrado`);
        }
        const personId = uploadRow.rows[0].person_id;

        const experiencias = estruturado.experiencias.map((item) => withOffset(texto, item));
        const formacao = estruturado.formacao.map((item) => withOffset(texto, item));
        const habilidades = estruturado.habilidades.map((item) => withOffset(texto, item));

        await client.query(
          `INSERT INTO person_profile (person_id, experiencias, formacao, habilidades)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (person_id) DO UPDATE
           SET experiencias = $2, formacao = $3, habilidades = $4, atualizado_em = now()`,
          [personId, JSON.stringify(experiencias), JSON.stringify(formacao), JSON.stringify(habilidades)],
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      await this.pool.query(`UPDATE resume_upload SET status = 'falhou' WHERE id = $1`, [payload.resumeUploadId]);
      throw err;
    }
  }
}

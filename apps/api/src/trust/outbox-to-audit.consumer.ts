import Redis from 'ioredis';
import { Pool } from 'pg';
import { TenantContext } from '../database/tenant-context';
import { AuditLogService } from './audit-log.service';

const CONSUMER_GROUP = 'trust-audit-consumer';
const CONSUMER_NAME = 'trust-audit-consumer-1';

/**
 * Consome o Redis Stream `outbox:{tenant_id}` (publicado por
 * OutboxPublisher, Task 12) via consumer group e grava cada evento como
 * uma entrada hash-chained em audit_log_entry (AuditLogService.append,
 * Task 13). É o lado receptor do portão de integração da Fase 0: prova
 * que um evento gravado por qualquer domínio de negócio (via outbox, na
 * mesma transação) chega ao log de auditoria sem intervenção manual.
 *
 * XGROUP CREATE com MKSTREAM é idempotente por design (BUSYGROUP é
 * ignorado) — chamar consumeOnce() repetidamente, inclusive de processos
 * diferentes, não recria nem reresetada o grupo. XACK só é enviado depois
 * que o append() no Postgres retorna com sucesso: se o processo cair entre
 * o append e o ack, a mensagem permanece pendente no grupo (visível via
 * XPENDING) para reprocessamento — at-least-once, simétrico ao
 * at-least-once do publisher (Task 12). Reprocessar o mesmo evento duas
 * vezes produz duas entradas em audit_log_entry (o log é, por natureza,
 * um append-only de "o que foi observado", então "o consumidor viu este
 * evento de novo" é ele próprio um fato honesto a registrar) — não há
 * deduplicação por id nesta task; fica para quando o volume de reprocesso
 * justificar a complexidade adicional.
 */
export class OutboxToAuditConsumer {
  private readonly ctx: TenantContext;
  private readonly audit = new AuditLogService();

  constructor(
    private readonly redis: Redis,
    appPool: Pool,
    private readonly tenantId: string,
  ) {
    this.ctx = new TenantContext(appPool);
  }

  private get streamKey() {
    return `outbox:${this.tenantId}`;
  }

  async consumeOnce(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', this.streamKey, CONSUMER_GROUP, '0', 'MKSTREAM');
    } catch (err) {
      if (!(err as Error).message.includes('BUSYGROUP')) throw err;
    }

    const result = await this.redis.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'COUNT', '10',
      'STREAMS', this.streamKey, '>',
    );

    if (!result) return;

    for (const [, entries] of result as unknown as [string, [string, string[]][]][]) {
      for (const [id, fields] of entries) {
        const record = this.fieldsToRecord(fields);

        await this.ctx.run(this.tenantId, (client) =>
          this.audit.append(client, {
            tenantId: this.tenantId,
            actorType: 'system',
            action: record.event_type,
            resourceType: record.aggregate_type,
            resourceId: record.aggregate_id,
            occurredAt: new Date(record.occurred_at),
          }),
        );

        await this.redis.xack(this.streamKey, CONSUMER_GROUP, id);
      }
    }
  }

  private fieldsToRecord(fields: string[]): Record<string, string> {
    const record: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      record[fields[i]] = fields[i + 1];
    }
    return record;
  }
}

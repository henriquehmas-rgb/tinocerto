import { Pool } from 'pg';
import Redis from 'ioredis';

interface PendingOutboxRow {
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  sequence: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

/**
 * Publica eventos pendentes de outbox_event em Redis Streams (um stream por
 * tenant: `outbox:{tenant_id}`), para consumo posterior via consumer group
 * (Task 13, Trust). Faz polling: chamado periodicamente por um scheduler
 * externo (fora do escopo desta task).
 *
 * Ordem XADD -> UPDATE published_at é proposital: se o processo cair (ou o
 * Redis falhar) entre as duas operações, o pior cenário é reenviar o mesmo
 * evento numa rodada futura (at-least-once, o consumidor deve ser
 * idempotente por `id`). Se a ordem fosse invertida, um evento poderia ser
 * marcado como publicado sem nunca ter chegado ao Redis — isso seria perda
 * silenciosa, não apenas duplicata, e não há como recuperar dele depois.
 *
 * Cada evento é isolado em try/catch: uma falha pontual (ex.: Redis
 * indisponível num evento específico) não pode travar o restante do lote,
 * já que a query busca sempre os mais antigos primeiro (ORDER BY
 * recorded_at) — sem isolamento, um evento problemático ficaria preso na
 * frente da fila para sempre, bloqueando todos os outros tenants.
 */
export class OutboxPublisher {
  constructor(
    private readonly adminPool: Pool,
    private readonly redis: Redis,
  ) {}

  async publishPending(): Promise<number> {
    const pending = await this.adminPool.query<PendingOutboxRow>(
      `SELECT * FROM outbox_event WHERE published_at IS NULL ORDER BY recorded_at LIMIT 100`,
    );

    let published = 0;
    for (const event of pending.rows) {
      try {
        await this.redis.xadd(
          `outbox:${event.tenant_id}`,
          '*',
          'id', event.id,
          'aggregate_type', event.aggregate_type,
          'aggregate_id', event.aggregate_id,
          'event_type', event.event_type,
          'sequence', event.sequence,
          'payload', JSON.stringify(event.payload),
          'occurred_at', event.occurred_at.toISOString(),
        );

        await this.adminPool.query(
          'UPDATE outbox_event SET published_at = now() WHERE id = $1',
          [event.id],
        );
        published += 1;
      } catch (err) {
        // Não relança: deixa o evento pendente para a próxima rodada de
        // polling tentar de novo, e segue para os demais eventos do lote.
        console.error(`outbox publish failed for event ${event.id}`, err);
      }
    }

    return published;
  }
}

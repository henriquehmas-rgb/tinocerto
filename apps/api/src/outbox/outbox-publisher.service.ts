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
 *
 * Distinção outage total vs. degradação parcial: se TODOS os eventos do
 * lote falharem (published === 0 && failed > 0), é sinal forte de que o
 * Redis está inteiro fora do ar — nesse caso lançamos um Error, porque
 * silenciar isso faria publishPending() retornar 0, indistinguível do caso
 * legítimo de "fila vazia" (quem chama este método não teria como saber que
 * nada foi publicado por causa de uma falha de infra, não por falta de
 * trabalho). Se só PARTE do lote falhar (published > 0 && failed > 0), é
 * degradação parcial tolerável dentro do modelo at-least-once já aprovado:
 * logamos o erro por evento e seguimos, sem lançar.
 *
 * A mensagem de erro final é deliberadamente neutra quanto ao componente
 * (não diz "no Redis"): o try/catch por evento envolve tanto o XADD quanto
 * o UPDATE subsequente de published_at, então uma falha total pode ter
 * origem no Postgres (o UPDATE), não no Redis — cravar "Redis" levaria quem
 * for investigar (dashboard, alerta, log) a olhar o sistema errado.
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
    let failed = 0;
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
        // Não relança aqui: deixa o evento pendente para a próxima rodada de
        // polling tentar de novo, e segue para os demais eventos do lote.
        // A decisão de lançar (ou não) para o chamador é tomada depois do
        // loop, com base no agregado published/failed — ver comentário da
        // classe.
        console.error(`outbox publish failed for event ${event.id}`, err);
        failed += 1;
      }
    }

    if (failed > 0 && published === 0) {
      throw new Error(
        `Falha ao publicar ${failed} evento(s) pendente(s) — nenhum publicado com sucesso`,
      );
    }

    return published;
  }
}

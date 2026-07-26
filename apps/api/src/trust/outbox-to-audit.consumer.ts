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
 * diferentes, não recria nem reseta o grupo.
 *
 * [Critical, revisão adversarial Task 14] at-least-once real exige
 * recuperar o PEL, não só documentar que ele existe. `XREADGROUP ... '>'`
 * devolve, por definição do Redis, APENAS mensagens NUNCA entregues a
 * nenhum consumidor do grupo — uma mensagem já entregue (mesmo que o
 * processo tenha caído antes do XACK) nunca mais aparece numa leitura com
 * '>', ela só existe no PEL (Pending Entries List, visível via XPENDING).
 * A versão anterior desta classe só lia com '>' e nunca tocava o PEL:
 * verificado empiricamente (3 eventos publicados, 1º append forçado a
 * falhar, 3 rodadas de consumeOnce() com append funcionando normalmente
 * nas rodadas seguintes) que os eventos ficavam órfãos no PEL para
 * sempre e ZERO linhas de auditoria eram gravadas — at-MOST-once na
 * prática, o oposto do que o docstring afirmava.
 *
 * Correção: cada consumeOnce() primeiro drena o PEL do próprio consumidor
 * com uma leitura `XREADGROUP ... '0'` (Redis define ID '0' como "só as
 * pendentes deste consumidor, sem entregar nada novo") ANTES de ler
 * mensagens novas com '>'. Como CONSUMER_NAME é fixo (uma única instância
 * lógica hoje), isso já recupera tudo que ficou pendente de uma rodada
 * anterior — se o processo cair entre o append e o ack, a mensagem
 * reaparece na leitura com '0' da PRÓXIMA chamada a consumeOnce() e é
 * reprocessada ali, produzindo o at-least-once que o docstring sempre
 * pretendeu descrever. (Para quando houver mais de uma instância deste
 * consumidor rodando ao mesmo tempo, XREADGROUP com '0' só devolve o PEL
 * do PRÓPRIO consumidor — recuperar pendências de consumidores mortos
 * exigiria XCLAIM/XAUTOCLAIM por min-idle-time, fora de escopo enquanto
 * houver uma instância só.)
 *
 * Reprocessar o mesmo evento duas vezes produz duas entradas em
 * audit_log_entry (o log é, por natureza, um append-only de "o que foi
 * observado", então "o consumidor viu este evento de novo" é ele próprio
 * um fato honesto a registrar) — não há deduplicação por id nesta task;
 * fica para quando o volume de reprocesso justificar a complexidade
 * adicional.
 *
 * [Important, revisão adversarial Task 14] Cada evento do lote (PEL +
 * novos) é isolado em try/catch, espelhando o padrão do OutboxPublisher
 * (Task 12, ver outbox-publisher.service.ts): uma falha pontual (ex.: um
 * append que bate no UNIQUE(tenant_id, chain_seq) sob concorrência, ou
 * uma mensagem malformada) não pode travar o restante do lote — a versão
 * anterior deixava a exceção propagar do meio do `for`, abortando até 9
 * eventos válidos subsequentes do mesmo lote de 10. O evento que falhou
 * NÃO recebe XACK, então continua no PEL e é retomado pela leitura com
 * '0' da próxima chamada (mecanismo acima). Mesma distinção outage total
 * vs. degradação parcial do publisher: se TODOS os eventos do lote
 * falharem (failed > 0 && processed === 0), é sinal forte de infra fora
 * do ar (Postgres ou Redis) e consumeOnce() lança; se só parte falhar, é
 * degradação tolerável dentro do modelo at-least-once — loga por evento e
 * segue.
 *
 * [Minor, revisão adversarial Task 14 fix2] `record.id` — o id da
 * mensagem original de outbox_event, propagado pelo OutboxPublisher como
 * o campo `id` do XADD (ver outbox-publisher.service.ts, que grava
 * `'id', event.id`) — é gravado em audit_log_entry.request_id via
 * append(). Isso dá a cada linha de auditoria um elo rastreável até o
 * evento de negócio que a originou: sem ele, uma linha duplicada (evento
 * reprocessado, ver at-least-once acima) era indistinguível de dois
 * fatos de negócio genuinamente diferentes gravados em sequência. O
 * `payload` completo e o `sequence` do evento continuam sendo
 * descartados de propósito — não fazem parte do rastro de auditoria (que
 * registra QUE algo aconteceu, não o conteúdo do evento) e permanecem
 * consultáveis em outbox_event.payload / outbox_event.sequence pelo
 * mesmo id agora gravado em request_id.
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

    // Drena primeiro o que já foi entregue a este consumidor e não foi
    // confirmado (PEL) — ver comentário da classe. ID '0' não entrega
    // mensagens novas, só devolve o histórico pendente deste consumidor.
    const pending = await this.redis.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'COUNT', '10',
      'STREAMS', this.streamKey, '0',
    );

    // Só então lê mensagens nunca entregues a nenhum consumidor do grupo.
    const fresh = await this.redis.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'COUNT', '10',
      'STREAMS', this.streamKey, '>',
    );

    let processed = 0;
    let failed = 0;

    for (const result of [pending, fresh]) {
      if (!result) continue;

      for (const [, entries] of result as unknown as [string, [string, string[]][]][]) {
        for (const [id, fields] of entries) {
          try {
            const record = this.fieldsToRecord(fields);

            await this.ctx.run(this.tenantId, (client) =>
              this.audit.append(client, {
                tenantId: this.tenantId,
                actorType: 'system',
                action: record.event_type,
                resourceType: record.aggregate_type,
                resourceId: record.aggregate_id,
                requestId: record.id,
                occurredAt: new Date(record.occurred_at),
              }),
            );

            await this.redis.xack(this.streamKey, CONSUMER_GROUP, id);
            processed += 1;
          } catch (err) {
            // Não relança aqui nem dá XACK: a mensagem permanece pendente
            // no grupo (PEL), visível via XPENDING, e é retomada pela
            // leitura com ID '0' no início da PRÓXIMA chamada a
            // consumeOnce() — ver comentário da classe. Isolar por evento
            // evita que um evento problemático derrube o restante do lote.
            console.error(
              `outbox-to-audit: falha ao consumir mensagem ${id} do stream ${this.streamKey}`,
              err,
            );
            failed += 1;
          }
        }
      }
    }

    if (failed > 0 && processed === 0) {
      throw new Error(
        `Falha ao consumir ${failed} mensagem(ns) do stream ${this.streamKey} — nenhuma processada com sucesso`,
      );
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

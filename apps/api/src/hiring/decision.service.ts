import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';

export interface RecordDecisionInput {
  tenantId: string;
  applicationId: string;
  tipo: 'aprovacao' | 'reprovacao' | 'oferta';
  motivoCodigo?: string;
  decidoPor: string;
}

@Injectable()
export class DecisionService {
  constructor(private readonly outbox: OutboxService) {}

  async record(client: PoolClient, input: RecordDecisionInput): Promise<{ id: string }> {
    if (!input.decidoPor) {
      throw new Error('decidoPor é obrigatório — nenhuma decisão pode ser registrada sem um usuário autenticado');
    }

    const result = await client.query<{ id: string }>(
      `INSERT INTO decision (tenant_id, application_id, tipo, motivo_codigo, decidido_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.tenantId, input.applicationId, input.tipo, input.motivoCodigo ?? null, input.decidoPor],
    );
    const id = result.rows[0].id;

    if (input.tipo === 'reprovacao') {
      const sequence = await nextOutboxSequence(client, input.applicationId);
      await this.outbox.write(client, {
        tenantId: input.tenantId,
        aggregateType: 'application',
        aggregateId: input.applicationId,
        eventType: 'application.rejected',
        sequence,
        payload: {
          application_id: input.applicationId,
          reason_code: input.motivoCodigo ?? null,
          // Sempre true nesta fase -- ver comentário no teste.
          review_requestable: true,
        },
        occurredAt: new Date(),
      });
    }

    return { id };
  }
}

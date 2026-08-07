import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';

export interface MarkStartedWorkInput {
  tenantId: string;
  applicationId: string;
  startDate: string; // 'YYYY-MM-DD'
  registradoPor: string;
}

export class NenhumaOfertaAceitaError extends Error {}
export class InicioTrabalhoJaRegistradoError extends Error {}

function isUniqueViolation(err: unknown, constraintName: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === '23505' &&
    (err as { constraint?: unknown }).constraint === constraintName
  );
}

@Injectable()
export class ApplicationStartedWorkService {
  constructor(private readonly outbox: OutboxService) {}

  // Marco manual (fim real do funil -- admissão): NUNCA inferido
  // automaticamente de nenhum evento anterior. Um humano sempre grava a
  // data. A única automação aqui é uma checagem de integridade -- não é
  // possível marcar "começou a trabalhar" numa candidatura que nunca teve
  // uma oferta aceita registrada, o que evitaria um estado inválido para
  // as métricas de time-to-fill (03-arquitetura §5.2) sem tornar o
  // registro do próprio marco automático.
  async registrar(client: PoolClient, input: MarkStartedWorkInput): Promise<{ id: string }> {
    const acceptedOffer = await client.query<{ id: string }>(
      `SELECT id FROM offer
        WHERE tenant_id = $1 AND application_id = $2 AND status = 'aceita'
        ORDER BY respondido_em DESC LIMIT 1`,
      [input.tenantId, input.applicationId],
    );
    if (acceptedOffer.rows.length === 0) {
      throw new NenhumaOfertaAceitaError(
        `candidatura ${input.applicationId} não tem nenhuma oferta aceita registrada -- não é possível marcar início de trabalho`,
      );
    }
    const offerId = acceptedOffer.rows[0].id;

    let id: string;
    try {
      const result = await client.query<{ id: string }>(
        `INSERT INTO application_started_work (tenant_id, application_id, offer_id, data_inicio, registrado_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [input.tenantId, input.applicationId, offerId, input.startDate, input.registradoPor],
      );
      id = result.rows[0].id;
    } catch (err) {
      if (isUniqueViolation(err, 'uq_started_work_tenant_application')) {
        throw new InicioTrabalhoJaRegistradoError(`candidatura ${input.applicationId} já tem início de trabalho registrado`);
      }
      throw err;
    }

    const sequence = await nextOutboxSequence(client, input.applicationId);
    await this.outbox.write(client, {
      tenantId: input.tenantId,
      aggregateType: 'application',
      aggregateId: input.applicationId,
      eventType: 'candidate.started_work',
      sequence,
      payload: { application_id: input.applicationId, start_date: input.startDate },
      occurredAt: new Date(),
    });

    return { id };
  }
}

import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface OutboxEventInput {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  sequence: number;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

@Injectable()
export class OutboxService {
  async write(client: PoolClient, event: OutboxEventInput): Promise<void> {
    await client.query(
      `INSERT INTO outbox_event
         (tenant_id, aggregate_type, aggregate_id, event_type, sequence, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.tenantId,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        event.sequence,
        JSON.stringify(event.payload),
        event.occurredAt,
      ],
    );
  }
}

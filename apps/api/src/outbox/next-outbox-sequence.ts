import { PoolClient } from 'pg';

export async function nextOutboxSequence(client: PoolClient, aggregateId: string): Promise<number> {
  const result = await client.query<{ next_sequence: string }>(
    `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM outbox_event WHERE aggregate_id = $1`,
    [aggregateId],
  );
  return Number(result.rows[0].next_sequence);
}

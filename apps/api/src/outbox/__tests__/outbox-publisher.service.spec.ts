import Redis from 'ioredis';
import { Pool } from 'pg';
import { OutboxPublisher } from '../outbox-publisher.service';

describe('OutboxPublisher.publishPending', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const redis = new Redis(process.env.REDIS_URL!);
  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Publisher', '00000000000008') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await redis.del(`outbox:${tenantId}`);
    await adminPool.end();
    await redis.quit();
  });

  it('publica eventos pendentes no Redis Stream e marca published_at', async () => {
    const aggregateId = '33333333-3333-3333-3333-333333333333';
    await adminPool.query(
      `INSERT INTO outbox_event (tenant_id, aggregate_type, aggregate_id, event_type, sequence, payload, occurred_at)
       VALUES ($1, 'test_aggregate', $2, 'test.published', 1, '{"x":1}', now())`,
      [tenantId, aggregateId],
    );

    const publisher = new OutboxPublisher(adminPool, redis);
    const count = await publisher.publishPending();

    expect(count).toBeGreaterThanOrEqual(1);

    const streamEntries = await redis.xrange(`outbox:${tenantId}`, '-', '+');
    expect(streamEntries.length).toBeGreaterThanOrEqual(1);

    const stillPending = await adminPool.query(
      'SELECT published_at FROM outbox_event WHERE aggregate_id = $1',
      [aggregateId],
    );
    expect(stillPending.rows[0].published_at).not.toBeNull();
  });
});

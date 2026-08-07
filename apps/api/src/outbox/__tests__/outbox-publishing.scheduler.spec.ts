import { Pool } from 'pg';
import Redis from 'ioredis';
import { OutboxPublishingScheduler } from '../outbox-publishing.scheduler';

describe('OutboxPublishingScheduler', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const redis = new Redis(process.env.REDIS_URL!);
  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Outbox Scheduler Ltda','00000000000200','test-tenant-00000000000200') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await redis.del(`outbox:${tenantId}`);
    await redis.quit();
    await adminPool.end();
  });

  it('um evento pendente gravado em outbox_event chega ao Redis Stream sem chamar publishPending() manualmente -- o laço próprio do scheduler faz isso sozinho', async () => {
    await adminPool.query(
      `INSERT INTO outbox_event (tenant_id, aggregate_type, aggregate_id, event_type, sequence, payload, occurred_at)
       VALUES ($1, 'gate_teste', gen_random_uuid(), 'gate.evento_teste', 1, '{"x":1}'::jsonb, now())`,
      [tenantId],
    );

    const scheduler = new OutboxPublishingScheduler();
    await scheduler.onModuleInit();
    try {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      const entries = await redis.xrange(`outbox:${tenantId}`, '-', '+');
      expect(entries.length).toBeGreaterThanOrEqual(1);
    } finally {
      await scheduler.onModuleDestroy();
    }
  }, 15_000);
});

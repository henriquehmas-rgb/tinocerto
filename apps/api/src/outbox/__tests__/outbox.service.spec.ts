import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { OutboxService } from '../outbox.service';

describe('OutboxService.write', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const pool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Outbox', '00000000000007') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await pool.end();
  });

  it('grava o evento na mesma transação e nunca com dual-write', async () => {
    const ctx = new TenantContext(pool);
    const outbox = new OutboxService();
    const aggregateId = '11111111-1111-1111-1111-111111111111';

    await ctx.run(tenantId, async (client) => {
      await outbox.write(client, {
        tenantId,
        aggregateType: 'test_aggregate',
        aggregateId,
        eventType: 'test.happened',
        sequence: 1,
        payload: { hello: 'world' },
        occurredAt: new Date(),
      });
    });

    const rows = await adminPool.query('SELECT * FROM outbox_event WHERE aggregate_id = $1', [
      aggregateId,
    ]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].published_at).toBeNull();
    expect(rows.rows[0].payload).toEqual({ hello: 'world' });
  });

  it('rejeita sequence duplicada para o mesmo aggregate_id (garante ordem por agregado)', async () => {
    const ctx = new TenantContext(pool);
    const outbox = new OutboxService();
    const aggregateId = '22222222-2222-2222-2222-222222222222';

    await ctx.run(tenantId, (client) =>
      outbox.write(client, {
        tenantId,
        aggregateType: 'test_aggregate',
        aggregateId,
        eventType: 'test.happened',
        sequence: 1,
        payload: {},
        occurredAt: new Date(),
      }),
    );

    await expect(
      ctx.run(tenantId, (client) =>
        outbox.write(client, {
          tenantId,
          aggregateType: 'test_aggregate',
          aggregateId,
          eventType: 'test.happened_again',
          sequence: 1,
          payload: {},
          occurredAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
  });
});

import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { OutboxService } from '../outbox.service';
import { nextOutboxSequence } from '../next-outbox-sequence';

describe('nextOutboxSequence', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Sequence', '00000000000016') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('retorna 1 para um agregado sem eventos ainda', async () => {
    const ctx = new TenantContext(appPool);
    const aggregateId = '11111111-2222-3333-4444-555555555501';

    const seq = await ctx.run(tenantId, (client) => nextOutboxSequence(client, aggregateId));
    expect(seq).toBe(1);
  });

  it('retorna sequência crescente conforme eventos são gravados no mesmo agregado', async () => {
    const ctx = new TenantContext(appPool);
    const outbox = new OutboxService();
    const aggregateId = '11111111-2222-3333-4444-555555555502';

    const seq1 = await ctx.run(tenantId, async (client) => {
      const seq = await nextOutboxSequence(client, aggregateId);
      await outbox.write(client, {
        tenantId,
        aggregateType: 'test_aggregate',
        aggregateId,
        eventType: 'test.happened',
        sequence: seq,
        payload: {},
        occurredAt: new Date(),
      });
      return seq;
    });
    expect(seq1).toBe(1);

    const seq2 = await ctx.run(tenantId, (client) => nextOutboxSequence(client, aggregateId));
    expect(seq2).toBe(2);
  });

  it('agregados diferentes têm contadores independentes', async () => {
    const ctx = new TenantContext(appPool);
    const outbox = new OutboxService();
    const aggregateA = '11111111-2222-3333-4444-555555555503';
    const aggregateB = '11111111-2222-3333-4444-555555555504';

    await ctx.run(tenantId, async (client) => {
      const seq = await nextOutboxSequence(client, aggregateA);
      await outbox.write(client, {
        tenantId,
        aggregateType: 'test_aggregate',
        aggregateId: aggregateA,
        eventType: 'test.happened',
        sequence: seq,
        payload: {},
        occurredAt: new Date(),
      });
    });

    const seqB = await ctx.run(tenantId, (client) => nextOutboxSequence(client, aggregateB));
    expect(seqB).toBe(1); // não herda a sequência do aggregateA
  });
});

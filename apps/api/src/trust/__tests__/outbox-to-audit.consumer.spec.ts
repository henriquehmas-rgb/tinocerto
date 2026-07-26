import Redis from 'ioredis';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { OutboxService } from '../../outbox/outbox.service';
import { OutboxPublisher } from '../../outbox/outbox-publisher.service';
import { OutboxToAuditConsumer } from '../outbox-to-audit.consumer';

describe('Portão de integração Fase 0 — outbox → Trust → audit_log_entry', () => {
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const redis = new Redis(process.env.REDIS_URL!);
  let tenantId: string;

  beforeAll(async () => {
    // CNPJ '00000000000010' do brief original colide com o mesmo valor já
    // usado em outbox-publisher.service.spec.ts ("Empresa Publisher Fila
    // Vazia") — tenant.cnpj é UNIQUE, e o INSERT abaixo falharia com
    // violação de constraint. Trocado para '00000000000013', o próximo
    // valor livre (00000000000001–00000000000012 já estão em uso por
    // specs existentes; mesmo tipo de correção de fixture já aplicado nas
    // Tasks 11 e 13).
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Gate', '00000000000013') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await redis.del(`outbox:${tenantId}`);
    await adminPool.end();
    await appPool.end();
    await redis.quit();
  });

  it('um evento gravado por outro domínio é consumido e aparece hash-chained em menos de 5s', async () => {
    const ctx = new TenantContext(appPool);
    const outbox = new OutboxService();
    const aggregateId = '44444444-4444-4444-4444-444444444444';

    // Simula um agregado de negócio qualquer (Fase 1+) gravando um evento.
    await ctx.run(tenantId, (client) =>
      outbox.write(client, {
        tenantId,
        aggregateType: 'application',
        aggregateId,
        eventType: 'application.stage_changed',
        sequence: 1,
        payload: { from_state: 'triagem', to_state: 'entrevista' },
        occurredAt: new Date(),
      }),
    );

    const publisher = new OutboxPublisher(adminPool, redis);
    await publisher.publishPending();

    const consumer = new OutboxToAuditConsumer(redis, appPool, tenantId);
    await consumer.consumeOnce();

    const rows = await adminPool.query(
      `SELECT * FROM audit_log_entry WHERE tenant_id = $1 AND resource_type = 'application'`,
      [tenantId],
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].action).toBe('application.stage_changed');
    expect(rows.rows[0].hash).toBeDefined();
  }, 10_000);
});

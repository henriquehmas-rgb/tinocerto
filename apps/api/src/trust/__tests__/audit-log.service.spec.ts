import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AuditLogService } from '../audit-log.service';

describe('AuditLogService.append — hash chain', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const pool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  // audit_log_entry.actor_id / resource_id são `uuid` na migration — usamos
  // literais em formato UUID válido aqui (o brief original usava 'user-1' /
  // 'laudo-1', que o Postgres rejeita com "invalid input syntax for type
  // uuid"; corrigido mantendo o mesmo ator/recurso reaproveitado nos dois
  // registros, igual à intenção original do teste).
  const actorId = '11111111-1111-1111-1111-111111111111';
  const resourceId = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Audit', '00000000000009') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await pool.end();
  });

  it('encadeia hash: o prev_hash do segundo registro é o hash do primeiro', async () => {
    const ctx = new TenantContext(pool);
    const audit = new AuditLogService();

    await ctx.run(tenantId, (client) =>
      audit.append(client, {
        tenantId,
        actorId,
        actorType: 'user',
        action: 'read',
        resourceType: 'laudo_psicologico',
        resourceId,
        occurredAt: new Date(),
      }),
    );

    await ctx.run(tenantId, (client) =>
      audit.append(client, {
        tenantId,
        actorId,
        actorType: 'user',
        action: 'export',
        resourceType: 'laudo_psicologico',
        resourceId,
        occurredAt: new Date(),
      }),
    );

    const rows = await adminPool.query(
      `SELECT prev_hash, hash FROM audit_log_entry WHERE tenant_id = $1 ORDER BY occurred_at`,
      [tenantId],
    );

    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].prev_hash).toBeNull();
    expect(rows.rows[1].prev_hash).toBe(rows.rows[0].hash);
    expect(rows.rows[0].hash).not.toBe(rows.rows[1].hash);
  });

  it('não permite UPDATE nem DELETE (append-only de verdade)', async () => {
    const rows = await adminPool.query<{ id: string }>(
      'SELECT id FROM audit_log_entry WHERE tenant_id = $1 LIMIT 1',
      [tenantId],
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(
        client.query(`UPDATE audit_log_entry SET action = 'forjado' WHERE id = $1`, [
          rows.rows[0].id,
        ]),
      ).rejects.toThrow();
      // A falha acima deixa a transação em estado abortado — ROLLBACK
      // limpa esse estado antes de abrir a próxima transação que testa
      // DELETE, sem precisar de uma segunda conexão.
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(
        client.query(`DELETE FROM audit_log_entry WHERE id = $1`, [rows.rows[0].id]),
      ).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

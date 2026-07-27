import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { RequisitionService } from '../requisition.service';

describe('RequisitionService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let orgUnitId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Requisition', '00000000000017', 'test-tenant-00000000000017') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    orgUnitId = org.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('abre uma requisição e grava requisition.opened no outbox na mesma transação', async () => {
    const ctx = new TenantContext(appPool);
    const service = new RequisitionService();

    const { id } = await ctx.run(tenantId, (client) =>
      service.open(client, { tenantId, orgUnitId, titulo: 'Analista de Operações Pleno' }),
    );

    const row = await adminPool.query('SELECT * FROM requisition WHERE id = $1', [id]);
    expect(row.rows[0].status).toBe('aberta');
    expect(row.rows[0].opened_at).not.toBeNull();

    const events = await adminPool.query(
      `SELECT event_type, payload FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'requisition.opened'`,
      [id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload.requisition_id).toBe(id);
    expect(events.rows[0].payload.org_unit_id).toBe(orgUnitId);
  });

  it('aprova uma requisição aberta e grava requisition.approved', async () => {
    const ctx = new TenantContext(appPool);
    const service = new RequisitionService();

    const { id } = await ctx.run(tenantId, (client) =>
      service.open(client, { tenantId, orgUnitId, titulo: 'Requisição a aprovar' }),
    );

    await ctx.run(tenantId, (client) => service.approve(client, id, 'user-aprovador-1'));

    const row = await adminPool.query('SELECT status, approved_at FROM requisition WHERE id = $1', [id]);
    expect(row.rows[0].status).toBe('aprovada');
    expect(row.rows[0].approved_at).not.toBeNull();

    const events = await adminPool.query(
      `SELECT payload FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'requisition.approved'`,
      [id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload.approved_by).toBe('user-aprovador-1');
  });

  it('rejeita aprovar requisição que já está fechada', async () => {
    const ctx = new TenantContext(appPool);
    const service = new RequisitionService();

    const { id } = await ctx.run(tenantId, (client) =>
      service.open(client, { tenantId, orgUnitId, titulo: 'Requisição a fechar' }),
    );
    await adminPool.query(`UPDATE requisition SET status = 'fechada', closed_at = now() WHERE id = $1`, [id]);

    await expect(ctx.run(tenantId, (client) => service.approve(client, id, 'user-1'))).rejects.toThrow(
      /não pode ser aprovada/,
    );
  });

  it('rejeita abrir requisição com org_unit de outro tenant (FK composta barra a referência cross-tenant)', async () => {
    const outroTenant = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Requisition Outro', '00000000000032', 'test-tenant-00000000000032') RETURNING id`,
    );
    const ctx = new TenantContext(appPool);
    const service = new RequisitionService();

    await expect(
      ctx.run(outroTenant.rows[0].id, (client) =>
        service.open(client, {
          tenantId: outroTenant.rows[0].id,
          orgUnitId, // pertence ao tenant original, não a outroTenant
          titulo: 'Requisição Vazando Org Unit',
        }),
      ),
    ).rejects.toThrow();

    await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenant.rows[0].id]);
  });
});

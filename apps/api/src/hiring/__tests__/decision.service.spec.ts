import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { DecisionService } from '../decision.service';
import { OutboxService } from '../../outbox/outbox.service';

describe('DecisionService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let applicationId: string;
  let userId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Decision', '00000000000023', 'test-tenant-00000000000023') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const user = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email, status) VALUES ($1, 'recrutador@example.com', 'ativo') RETURNING id`,
      [tenantId],
    );
    userId = user.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Decision', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, publicado_em, canais)
       VALUES ($1, $2, 'Vaga Decision', 'vaga-decision-test', now(), '{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-decision', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Decision Teste', 'decision@example.com')
       RETURNING id`,
    );
    const application = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, job.rows[0].id, person.rows[0].id],
    );
    applicationId = application.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM decision WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person WHERE nome = $1', ['Decision Teste']);
    await adminPool.query('DELETE FROM user_account WHERE id = $1', [userId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('registra uma reprovação com revisao_solicitada e grava application.rejected', async () => {
    const ctx = new TenantContext(appPool);
    const service = new DecisionService(new OutboxService());

    const { id } = await ctx.run(tenantId, (client) =>
      service.record(client, {
        tenantId,
        applicationId,
        tipo: 'reprovacao',
        motivoCodigo: 'perfil_nao_aderente',
        decidoPor: userId,
      }),
    );

    const row = await adminPool.query('SELECT tipo, revisao_solicitada, decidido_por FROM decision WHERE id = $1', [id]);
    expect(row.rows[0].tipo).toBe('reprovacao');
    expect(row.rows[0].revisao_solicitada).toBe(false);
    expect(row.rows[0].decidido_por).toBe(userId);

    const events = await adminPool.query(
      `SELECT payload FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'application.rejected'`,
      [applicationId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload.reason_code).toBe('perfil_nao_aderente');
    // review_requestable sempre true nesta fase -- não há decisão
    // automatizada ainda, então toda reprovação é elegível a revisão
    // (02-requisitos-e-compliance.md §3.4: botão em TODA tela de
    // reprovação, não só nas automatizadas -- a distinção só importa
    // quando existir decisão automatizada de verdade).
    expect(events.rows[0].payload.review_requestable).toBe(true);
  });

  it('rejeita gravar decisão sem decidido_por (constraint NOT NULL)', async () => {
    const ctx = new TenantContext(appPool);
    const service = new DecisionService(new OutboxService());

    await expect(
      ctx.run(tenantId, (client) =>
        service.record(client, {
          tenantId,
          applicationId,
          tipo: 'reprovacao',
          decidoPor: undefined as unknown as string,
        }),
      ),
    ).rejects.toThrow();
  });
});

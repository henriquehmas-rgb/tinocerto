import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { ApplicationService } from '../application.service';
import { PipelineStageTransitionService } from '../pipeline-stage-transition.service';
import { OutboxService } from '../../outbox/outbox.service';

describe('PipelineStageTransitionService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let applicationId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Pipeline', '00000000000022') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Pipeline', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, publicado_em, canais)
       VALUES ($1, $2, 'Vaga Pipeline', 'vaga-pipeline-test', now(), '{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-pipeline', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Pipeline Teste', 'pipeline@example.com')
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
    await adminPool.query('DELETE FROM pipeline_stage_transition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person WHERE nome = $1', ['Pipeline Teste']);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('move a candidatura de triagem para entrevista, grava transição e application.stage_changed', async () => {
    const ctx = new TenantContext(appPool);
    const applicationService = new ApplicationService(new OutboxService());
    const service = new PipelineStageTransitionService(applicationService, new OutboxService());

    await ctx.run(tenantId, (client) =>
      service.moveStage(client, {
        applicationId,
        toState: 'entrevista',
        reasonCode: 'triagem_aprovada',
        actorId: '11111111-1111-1111-1111-111111111111',
        actorType: 'user',
      }),
    );

    const app = await adminPool.query('SELECT etapa_funil FROM application WHERE id = $1', [applicationId]);
    expect(app.rows[0].etapa_funil).toBe('entrevista');

    const transition = await adminPool.query(
      'SELECT from_state, to_state, reason_code, actor_id FROM pipeline_stage_transition WHERE application_id = $1',
      [applicationId],
    );
    expect(transition.rows).toHaveLength(1);
    expect(transition.rows[0].from_state).toBe('triagem');
    expect(transition.rows[0].to_state).toBe('entrevista');

    const events = await adminPool.query(
      `SELECT payload FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'application.stage_changed'`,
      [applicationId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload.from_state).toBe('triagem');
    expect(events.rows[0].payload.to_state).toBe('entrevista');
  });

  it('transição não permite UPDATE (append-only)', async () => {
    const row = await adminPool.query('SELECT id FROM pipeline_stage_transition WHERE application_id = $1 LIMIT 1', [
      applicationId,
    ]);
    const ctx = new TenantContext(appPool);
    await expect(
      ctx.run(tenantId, (client) =>
        client.query(`UPDATE pipeline_stage_transition SET to_state = 'forjado' WHERE id = $1`, [row.rows[0].id]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { OutboxService } from '../../outbox/outbox.service';
import { DecisionService } from '../decision.service';
import { OfferService } from '../offer.service';
import { PipelineStageTransitionService } from '../pipeline-stage-transition.service';
import { ApplicationService } from '../application.service';
import { CandidateEvaluationViewService } from '../candidate-evaluation-view.service';

describe('CandidateEvaluationViewService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const decisionService = new DecisionService(new OutboxService());
  const offerService = new OfferService(new OutboxService(), decisionService);
  const stageService = new PipelineStageTransitionService(new ApplicationService(new OutboxService()), new OutboxService());
  const viewService = new CandidateEvaluationViewService();

  let tenantId: string;
  let applicationId: string;
  let recrutadorId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Avaliacao Ltda','00000000000128','test-tenant-00000000000128') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Avaliacao', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Avaliacao', 'vaga-avaliacao-test') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-avaliacao','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato Avaliacao','avaliacao@example.com') RETURNING id`,
    );
    const application = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, job.rows[0].id, person.rows[0].id],
    );
    applicationId = application.rows[0].id;
    const recrutador = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador-avaliacao@example.com') RETURNING id`,
      [tenantId],
    );
    recrutadorId = recrutador.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM offer WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM decision WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM pipeline_stage_transition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-avaliacao'`);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('monta a vista com etapas percorridas, decisão de reprovação com podeSolicitarRevisao=true, e nenhuma identidade de staff', async () => {
    await tenantContext.run(tenantId, (client) =>
      stageService.moveStage(client, { applicationId, toState: 'entrevista', actorId: recrutadorId, actorType: 'user' }),
    );
    await tenantContext.run(tenantId, (client) =>
      decisionService.record(client, {
        tenantId,
        applicationId,
        tipo: 'reprovacao',
        motivoCodigo: 'perfil_comportamental_fora_do_esperado',
        decidoPor: recrutadorId,
      }),
    );

    const view = await tenantContext.run(tenantId, (client) => viewService.build(client, tenantId, applicationId));

    expect(view.etapasPercorridas.length).toBeGreaterThan(0);
    expect(view.decisao?.tipo).toBe('reprovacao');
    expect(view.decisao?.motivoCodigo).toBe('perfil_comportamental_fora_do_esperado');
    expect(view.decisao?.podeSolicitarRevisao).toBe(true);

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(recrutadorId); // nenhuma identidade de staff vaza para a resposta
    expect(serialized.toLowerCase()).not.toContain('decidido_por');
    expect(serialized.toLowerCase()).not.toContain('estendido_por');
    expect(serialized.toLowerCase()).not.toContain('respondido_por');
  });

  it('oferta aparece na vista com valor mas sem identidade de staff', async () => {
    const { id: offerId } = await tenantContext.run(tenantId, (client) =>
      offerService.extend(client, { tenantId, applicationId, valor: '9500.00', estendidoPor: recrutadorId }),
    );
    await tenantContext.run(tenantId, (client) => offerService.accept(client, { tenantId, offerId, respondidoPor: recrutadorId }));

    const view = await tenantContext.run(tenantId, (client) => viewService.build(client, tenantId, applicationId));

    expect(view.oferta?.status).toBe('aceita');
    expect(view.oferta?.valor).toBe('9500.00');
    expect(JSON.stringify(view.oferta)).not.toContain(recrutadorId);
  });
});

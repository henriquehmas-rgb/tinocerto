import { Pool } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AdverseImpactConsumer } from '../adverse-impact.consumer';
import { AdverseImpactSnapshotService } from '../adverse-impact-snapshot.service';

function fakeDatabaseService(pool: Pool): DatabaseService {
  return { pool } as DatabaseService;
}

describe('AdverseImpactConsumer', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let jobId: string;
  let personId: string;
  let applicationId: string;
  const extraPersonIds: string[] = [];
  // Guardado para fechar a conexão Redis aberta no construtor de cada
  // teste -- onModuleInit/onModuleDestroy nunca são chamados
  // automaticamente aqui (instanciação direta, fora do ciclo de vida do
  // Nest, mesmo padrão de candidate-application-summary.consumer.spec.ts).
  // Sem isso, a conexão TCP viva mantém o event loop ativo e o Jest nunca
  // sai sozinho ao final do arquivo.
  let consumer: AdverseImpactConsumer | undefined;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Consumer Insights', '00000000000068', 'test-tenant-00000000000068') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Consumer', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Consumer', 'vaga-consumer-insights') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;

    // LIMIAR_MINIMO_GRUPO (Task 3) exige pelo menos 5 candidaturas no
    // grupo para calcularRazoes4Quintos gerar qualquer linha -- sem isso
    // recompute() legitimamente não produz nada, e os testes abaixo (que
    // verificam SÓ a fiação evento->recompute, não a estatística em si)
    // falhariam por amostra pequena, não por bug de fiação. 4 candidatos
    // extras "de encher" + o principal (personId/applicationId, usado nos
    // eventos), todos "feminino".
    for (let i = 0; i < 4; i++) {
      const extra = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ($1, '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Candidato Encher', $2)
         RETURNING id`,
        [`hash-consumer-insights-extra-${i}`, `consumer-insights-extra-${i}@example.com`],
      );
      extraPersonIds.push(extra.rows[0].id);
      const consentExtra = await adminPool.query<{ id: string }>(
        `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'autodeclaracao_diversidade', 'consentimento') RETURNING id`,
        [extra.rows[0].id, tenantId],
      );
      await adminPool.query(
        `INSERT INTO demographic_self_report (tenant_id, person_id, genero, consent_id) VALUES ($1, $2, 'feminino', $3)`,
        [tenantId, extra.rows[0].id, consentExtra.rows[0].id],
      );
      await adminPool.query(`INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3)`, [
        tenantId,
        jobId,
        extra.rows[0].id,
      ]);
    }

    const p = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-consumer-insights', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Candidato Consumer', 'consumer.insights@example.com')
       RETURNING id`,
    );
    personId = p.rows[0].id;
    const consent = await adminPool.query<{ id: string }>(
      `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'autodeclaracao_diversidade', 'consentimento') RETURNING id`,
      [personId, tenantId],
    );
    await adminPool.query(
      `INSERT INTO demographic_self_report (tenant_id, person_id, genero, consent_id) VALUES ($1, $2, 'feminino', $3)`,
      [tenantId, personId, consent.rows[0].id],
    );
    const app = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, jobId, personId],
    );
    applicationId = app.rows[0].id;
  });

  afterEach(async () => {
    await consumer?.onModuleDestroy();
    consumer = undefined;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM adverse_impact_snapshot WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM pipeline_stage_transition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM demographic_self_report WHERE tenant_id = $1', [tenantId]);
    const todosOsPersonIds = [personId, ...extraPersonIds];
    await adminPool.query('DELETE FROM consent WHERE person_id = ANY($1)', [todosOsPersonIds]);
    await adminPool.query('DELETE FROM person WHERE id = ANY($1)', [todosOsPersonIds]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('application.created recalcula o snapshot usando job_id do próprio payload', async () => {
    consumer = new AdverseImpactConsumer(new AdverseImpactSnapshotService(), fakeDatabaseService(appPool));

    await consumer.handleEvent({
      eventType: 'application.created',
      tenantId,
      payload: { application_id: applicationId, job_id: jobId, person_id: personId },
    });

    const linhas = await adminPool.query(
      `SELECT * FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2 AND etapa = 'triagem'`,
      [tenantId, jobId],
    );
    expect(linhas.rows.length).toBeGreaterThan(0);
  });

  it('application.stage_changed resolve job_id via lookup (payload não carrega job_id)', async () => {
    await adminPool.query(
      `INSERT INTO pipeline_stage_transition (application_id, tenant_id, from_state, to_state, actor_id, actor_type)
       VALUES ($1, $2, 'triagem', 'entrevista', $3, 'user')`,
      [applicationId, tenantId, personId],
    );

    consumer = new AdverseImpactConsumer(new AdverseImpactSnapshotService(), fakeDatabaseService(appPool));

    await consumer.handleEvent({
      eventType: 'application.stage_changed',
      tenantId,
      payload: { application_id: applicationId, from_state: 'triagem', to_state: 'entrevista', reason_code: null },
    });

    const linhas = await adminPool.query(
      `SELECT * FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2 AND etapa = 'entrevista'`,
      [tenantId, jobId],
    );
    expect(linhas.rows.length).toBeGreaterThan(0);
  });

  it('candidatura inexistente não derruba o consumidor -- só não recalcula nada', async () => {
    consumer = new AdverseImpactConsumer(new AdverseImpactSnapshotService(), fakeDatabaseService(appPool));

    await expect(
      consumer.handleEvent({
        eventType: 'application.rejected',
        tenantId,
        payload: { application_id: '00000000-0000-0000-0000-000000000000', reason_code: null, review_requestable: true },
      }),
    ).resolves.not.toThrow();
  });
});

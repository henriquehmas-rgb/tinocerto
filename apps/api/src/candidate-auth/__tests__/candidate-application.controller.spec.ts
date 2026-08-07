import { ConflictException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { CandidateApplicationController } from '../candidate-application.controller';
import { CandidateEvaluationViewService } from '../../hiring/candidate-evaluation-view.service';
import { DecisionService } from '../../hiring/decision.service';
import { OutboxService } from '../../outbox/outbox.service';

describe('CandidateApplicationController', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let personId: string;
  // [Fase 3d] candidate_application_summary.tenant_id volta ao schema
  // (resume_0006) e agora é NOT NULL -- precisa de um tenant real de
  // fixture, ao contrário do comentário histórico que existia aqui (que
  // documentava por que tenant_id tinha sido removido na Fase 1b). Um
  // único tenant é compartilhado entre este describe e o de
  // avaliacao/solicitar-revisao abaixo -- evita CNPJ duplicado (UNIQUE) e
  // simplifica o cleanup.
  let tenantId: string;

  beforeAll(async () => {
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-candidate-app-ctrl', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Teste Ctrl', 'ctrl@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;
    const tenant = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Ctrl Test', '00000000000129', 'empresa-ctrl-test') RETURNING id`,
    );
    tenantId = tenant.rows[0].id;
    await adminPool.query(
      `INSERT INTO candidate_application_summary (person_id, application_id, job_titulo, etapa_funil, tenant_id)
       VALUES ($1, '22222222-3333-4444-5555-666666666699', 'Vaga Ctrl Test', 'entrevista', $2)`,
      [personId, tenantId],
    );
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM candidate_application_summary WHERE person_id = $1', [personId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
  });

  it('lista as candidaturas do candidato autenticado, ordenadas pela mais recente', async () => {
    const controller = new CandidateApplicationController(adminPool, new CandidateEvaluationViewService(), new DecisionService(new OutboxService()));

    const result = await controller.listMyApplications({ personId } as any);

    expect(result).toHaveLength(1);
    expect(result[0].jobTitulo).toBe('Vaga Ctrl Test');
    expect(result[0].etapaFunil).toBe('entrevista');
  });

  // [Fase 3d] "Como fomos avaliados" + solicitar-revisão. avaliacao()/
  // solicitarRevisao() abrem um TenantContext.run real e leem
  // decision/pipeline_stage_transition/offer, todas tenant-scoped com RLS
  // FORCE -- ao contrário do describe acima (que só lê
  // candidate_application_summary, sem RLS), application_id aqui precisa
  // apontar para uma linha real de `application` no mesmo tenant.
  describe('avaliacao / solicitar-revisao (Fase 3d)', () => {
    const evalPool = new Pool({ connectionString: process.env.DATABASE_URL });
    let applicationIdReprovada: string;
    let applicationIdSemDecisao: string;
    let outroPersonId: string;
    let recrutadorId: string;
    const controller = new CandidateApplicationController(adminPool, new CandidateEvaluationViewService(), new DecisionService(new OutboxService()));

    beforeAll(async () => {
      const org = await evalPool.query<{ id: string }>(
        `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
        [tenantId],
      );
      const req = await evalPool.query<{ id: string }>(
        `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Avaliacao Ctrl', 'aprovada', now()) RETURNING id`,
        [tenantId, org.rows[0].id],
      );
      const job = await evalPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Avaliacao Ctrl', 'vaga-avaliacao-ctrl-test') RETURNING id`,
        [tenantId, req.rows[0].id],
      );
      const recrutador = await evalPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador-avaliacao-ctrl@example.com') RETURNING id`,
        [tenantId],
      );
      recrutadorId = recrutador.rows[0].id;

      const appReprovada = await evalPool.query<{ id: string }>(
        `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, job.rows[0].id, personId],
      );
      applicationIdReprovada = appReprovada.rows[0].id;
      await evalPool.query(
        `INSERT INTO candidate_application_summary (person_id, application_id, job_titulo, etapa_funil, tenant_id)
         VALUES ($1, $2, 'Vaga Avaliacao Ctrl', 'reprovado', $3)`,
        [personId, applicationIdReprovada, tenantId],
      );
      await evalPool.query(
        `INSERT INTO decision (tenant_id, application_id, tipo, motivo_codigo, decidido_por)
         VALUES ($1, $2, 'reprovacao', 'perfil_nao_aderente', $3)`,
        [tenantId, applicationIdReprovada, recrutadorId],
      );

      const appSemDecisao = await evalPool.query<{ id: string }>(
        `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, job.rows[0].id, personId],
      );
      applicationIdSemDecisao = appSemDecisao.rows[0].id;
      await evalPool.query(
        `INSERT INTO candidate_application_summary (person_id, application_id, job_titulo, etapa_funil, tenant_id)
         VALUES ($1, $2, 'Vaga Avaliacao Ctrl', 'triagem', $3)`,
        [personId, applicationIdSemDecisao, tenantId],
      );

      const outraPessoa = await evalPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-outra-pessoa-ctrl', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Outra Pessoa', 'outra-pessoa-ctrl@example.com') RETURNING id`,
      );
      outroPersonId = outraPessoa.rows[0].id;
    });

    afterAll(async () => {
      await evalPool.query('DELETE FROM decision WHERE tenant_id = $1', [tenantId]);
      await evalPool.query(
        'DELETE FROM candidate_application_summary WHERE application_id IN ($1, $2)',
        [applicationIdReprovada, applicationIdSemDecisao],
      );
      await evalPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
      await evalPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
      await evalPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
      await evalPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
      await evalPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
      await evalPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-outra-pessoa-ctrl'`);
      await evalPool.end();
    });

    it('GET :id/avaliacao de uma candidatura própria devolve a vista completa', async () => {
      const view = await controller.avaliacao({ personId } as any, applicationIdReprovada);

      expect(view.applicationId).toBe(applicationIdReprovada);
      expect(view.decisao?.tipo).toBe('reprovacao');
      expect(view.decisao?.motivoCodigo).toBe('perfil_nao_aderente');
      expect(view.decisao?.podeSolicitarRevisao).toBe(true);
    });

    it('GET :id/avaliacao de uma candidatura de OUTRA pessoa devolve 404 (nunca 403 -- não revela existência)', async () => {
      await expect(controller.avaliacao({ personId: outroPersonId } as any, applicationIdReprovada)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('POST :id/actions/solicitar-revisao numa candidatura reprovada marca revisao_solicitada; chamar de novo devolve 409', async () => {
      await expect(controller.solicitarRevisao({ personId } as any, applicationIdReprovada)).resolves.toBeDefined();

      const row = await evalPool.query<{ revisao_solicitada: boolean }>(
        `SELECT revisao_solicitada FROM decision WHERE tenant_id = $1 AND application_id = $2`,
        [tenantId, applicationIdReprovada],
      );
      expect(row.rows[0].revisao_solicitada).toBe(true);

      await expect(controller.solicitarRevisao({ personId } as any, applicationIdReprovada)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('POST :id/actions/solicitar-revisao numa candidatura sem decisão de reprovação devolve 404', async () => {
      await expect(controller.solicitarRevisao({ personId } as any, applicationIdSemDecisao)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

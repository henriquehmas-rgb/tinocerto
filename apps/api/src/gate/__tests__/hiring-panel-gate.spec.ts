// apps/api/src/gate/__tests__/hiring-panel-gate.spec.ts
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { mintStaffJwt } from '../../staff-auth/__tests__/mint-staff-jwt';

describe('Gate consolidado — Painel do Recrutador (Fase 5a, Tasks 2-4)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  let app: INestApplication;
  let serverUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.listen(0);
    serverUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    await adminPool.end();
  }, 20000);

  it(
    'ponta a ponta: admin_tenant cria vaga já atribuída a um recrutador -> recrutador atribuído vê a vaga na ' +
      'listagem -> funil mostra a candidatura em "triagem" -> mover etapa reflete "entrevista" no funil seguinte -> ' +
      'assessment-report sem result_grant devolve relatorio null sem lançar erro -> um SEGUNDO recrutador, não ' +
      'atribuído à vaga, tem funil e move-stage rejeitados com 404 (guarda de posse)',
    async () => {
      let tenantId: string | undefined;

      try {
        // --- 1. Tenant + 2 staff (admin_tenant, recrutador) via fixture direta de banco ---
        const tenant = await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate Painel Recrutador Ltda','00000000000280','test-tenant-gate-painel-recrutador') RETURNING id`,
        );
        tenantId = tenant.rows[0].id;

        const adminUser = await adminPool.query<{ id: string }>(
          `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'admin-gate-painel-recrutador@example.com') RETURNING id`,
          [tenantId],
        );
        const adminId = adminUser.rows[0].id;
        const adminToken = mintStaffJwt({ userId: adminId, tenantId, roles: ['admin_tenant'] });

        const recrutador1 = await adminPool.query<{ id: string }>(
          `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador1-gate-painel-recrutador@example.com') RETURNING id`,
          [tenantId],
        );
        const recrutador1Id = recrutador1.rows[0].id;
        const recrutador1Token = mintStaffJwt({ userId: recrutador1Id, tenantId, roles: ['recrutador'] });

        const recrutador2 = await adminPool.query<{ id: string }>(
          `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador2-gate-painel-recrutador@example.com') RETURNING id`,
          [tenantId],
        );
        const recrutador2Id = recrutador2.rows[0].id;
        const recrutador2Token = mintStaffJwt({ userId: recrutador2Id, tenantId, roles: ['recrutador'] });

        // --- Fixtures de suporte para criar a vaga: org_unit + requisition aprovada ---
        const orgUnit = await adminPool.query<{ id: string }>(
          `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
          [tenantId],
        );
        const requisition = await adminPool.query<{ id: string }>(
          `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Gate Painel Recrutador', 'aprovada', now()) RETURNING id`,
          [tenantId, orgUnit.rows[0].id],
        );
        const requisitionId = requisition.rows[0].id;

        // --- 2. admin_tenant cria a vaga já com recrutadorIds -- prova que POST /v1/jobs
        // aceita e persiste a atribuição de recrutador (Task 2/3) ---
        const respCreateJob = await fetch(`${serverUrl}/v1/jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({
            requisitionId,
            titulo: 'Vaga Gate Painel Recrutador',
            recrutadorIds: [recrutador1Id],
          }),
        });
        expect(respCreateJob.status).toBe(201);
        const corpoCreateJob = (await respCreateJob.json()) as { id: string };
        expect(corpoCreateJob.id).toEqual(expect.any(String));
        const jobId = corpoCreateJob.id;

        const recrutadorAtribuido = await adminPool.query(
          `SELECT 1 FROM job_recrutador WHERE job_id = $1 AND tenant_id = $2 AND staff_id = $3`,
          [jobId, tenantId, recrutador1Id],
        );
        expect(recrutadorAtribuido.rows).toHaveLength(1);

        // --- 3. recrutador atribuído lista vagas -- prova que a vaga aparece pra ele ---
        const respListJobs = await fetch(`${serverUrl}/v1/jobs`, {
          headers: { authorization: `Bearer ${recrutador1Token}` },
        });
        expect(respListJobs.status).toBe(200);
        const corpoListJobs = (await respListJobs.json()) as Array<{ id: string }>;
        expect(corpoListJobs.map((j) => j.id)).toContain(jobId);

        // --- 4. Candidatura para essa vaga via fixture direta (criação de candidatura é
        // fluxo do candidato, fora de escopo aqui) ---
        const person = await adminPool.query<{ id: string }>(
          `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
           VALUES ('hash-gate-painel-recrutador', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Candidato Gate Painel Recrutador', 'candidato-gate-painel-recrutador@example.com') RETURNING id`,
        );
        const personId = person.rows[0].id;
        const application = await adminPool.query<{ id: string }>(
          `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, jobId, personId],
        );
        const applicationId = application.rows[0].id;

        // --- 5. recrutador atribuído consulta o funil -- candidatura aparece em "triagem" ---
        const respFunilTriagem = await fetch(`${serverUrl}/v1/jobs/${jobId}/funil`, {
          headers: { authorization: `Bearer ${recrutador1Token}` },
        });
        expect(respFunilTriagem.status).toBe(200);
        const corpoFunilTriagem = (await respFunilTriagem.json()) as {
          funil: Record<string, Array<{ id: string }>>;
          conversao: Record<string, number | null>;
        };
        expect(corpoFunilTriagem.funil.triagem?.map((c) => c.id)).toContain(applicationId);

        // --- 6. recrutador atribuído move a candidatura -- reflete em "entrevista" no funil seguinte ---
        const respMoveStage = await fetch(`${serverUrl}/v1/applications/${applicationId}/actions/move-stage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${recrutador1Token}` },
          body: JSON.stringify({ toState: 'entrevista' }),
        });
        expect(respMoveStage.status).toBe(201);
        const corpoMoveStage = (await respMoveStage.json()) as { id: string };
        expect(corpoMoveStage.id).toEqual(expect.any(String));

        const respFunilEntrevista = await fetch(`${serverUrl}/v1/jobs/${jobId}/funil`, {
          headers: { authorization: `Bearer ${recrutador1Token}` },
        });
        expect(respFunilEntrevista.status).toBe(200);
        const corpoFunilEntrevista = (await respFunilEntrevista.json()) as {
          funil: Record<string, Array<{ id: string }>>;
          conversao: Record<string, number | null>;
        };
        expect(corpoFunilEntrevista.funil.entrevista?.map((c) => c.id)).toContain(applicationId);
        expect(corpoFunilEntrevista.funil.triagem?.map((c) => c.id) ?? []).not.toContain(applicationId);

        // --- 7. recrutador atribuído consulta assessment-report sem result_grant -- devolve
        // relatorio null (candidato ainda não fez assessment) sem lançar erro ---
        const respAssessmentReport = await fetch(`${serverUrl}/v1/applications/${applicationId}/assessment-report`, {
          headers: { authorization: `Bearer ${recrutador1Token}` },
        });
        expect(respAssessmentReport.status).toBe(200);
        const corpoAssessmentReport = (await respAssessmentReport.json()) as { relatorio: unknown; aderencia: unknown };
        expect(corpoAssessmentReport.relatorio).toBeNull();
        expect(corpoAssessmentReport).toHaveProperty('aderencia');

        // --- 8. Caso negativo: um SEGUNDO recrutador, não atribuído à vaga, tem funil e
        // move-stage rejeitados com 404 (guarda de posse -- JobRecrutadorService.exigirAcesso) ---
        const respFunilNaoAtribuido = await fetch(`${serverUrl}/v1/jobs/${jobId}/funil`, {
          headers: { authorization: `Bearer ${recrutador2Token}` },
        });
        expect(respFunilNaoAtribuido.status).toBe(404);

        const respMoveStageNaoAtribuido = await fetch(`${serverUrl}/v1/applications/${applicationId}/actions/move-stage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${recrutador2Token}` },
          body: JSON.stringify({ toState: 'oferta' }),
        });
        expect(respMoveStageNaoAtribuido.status).toBe(404);
      } finally {
        if (tenantId) {
          await adminPool.query(`DELETE FROM outbox_event WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(
            `DELETE FROM pipeline_stage_transition WHERE tenant_id = $1`,
            [tenantId],
          );
          await adminPool.query(
            `DELETE FROM application WHERE job_id IN (SELECT id FROM job WHERE tenant_id = $1)`,
            [tenantId],
          );
          await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-gate-painel-recrutador'`);
          await adminPool.query(`DELETE FROM job_recrutador WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM job WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM requisition WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM org_unit WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM staff_refresh_token WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM role_assignment WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM user_account WHERE tenant_id = $1`, [tenantId]);
          await adminPool.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
        }
      }
    },
    60000,
  );
});

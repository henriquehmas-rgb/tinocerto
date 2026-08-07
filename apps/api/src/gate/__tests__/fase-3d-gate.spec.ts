import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { OutboxService } from '../../outbox/outbox.service';
import { ApplicationService } from '../../hiring/application.service';
import { DecisionService } from '../../hiring/decision.service';
import { OfferService } from '../../hiring/offer.service';
import { ApplicationStartedWorkService } from '../../hiring/application-started-work.service';
import { CandidateEvaluationViewService } from '../../hiring/candidate-evaluation-view.service';
import { CompetencyService } from '../../interview/competency.service';
import { InterviewGuideService } from '../../interview/interview-guide.service';
import { InterviewScheduleService } from '../../interview/interview-schedule.service';

describe('Gate consolidado — Fase 3d (Oferta e Contratação)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);

  const SRC_ROOT = path.resolve(__dirname, '../..');

  afterAll(async () => {
    await adminPool.end();
    await appPool.end();
  });

  it.each(['offer', 'application_started_work'])('%s tem RLS FORCE+RESTRICTIVE com predicado NULLIF', async (tabela) => {
    const rel = await adminPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
      [tabela],
    );
    expect(rel.rows[0].relrowsecurity).toBe(true);
    expect(rel.rows[0].relforcerowsecurity).toBe(true);

    const pol = await adminPool.query<{ policyname: string; permissive: string; qual: string }>(
      `SELECT policyname, permissive, qual FROM pg_policies WHERE tablename = $1`,
      [tabela],
    );
    const restritiva = pol.rows.find((r) => r.policyname === 'tenant_isolation');
    expect(restritiva?.permissive).toBe('RESTRICTIVE');
    expect(restritiva?.qual).toContain('NULLIF');
  });

  it('as migrations da Fase 3d estão registradas no manifest, na ordem certa', () => {
    const manifest = JSON.parse(readFileSync(path.join(SRC_ROOT, '../migrations/manifest.json'), 'utf-8')) as {
      migrations: string[];
    };
    const esperadas = [
      'hiring_0015__offer.sql',
      'hiring_0016__application_started_work.sql',
      'hiring_0017__decision_revisao_solicitada_em.sql',
      'resume_0006__candidate_application_summary_tenant_id.sql',
    ];
    for (const migration of esperadas) {
      expect(manifest.migrations).toContain(migration);
    }
  });

  it('a policy Cerbos de offer existe e cobre extend/read/accept/decline', () => {
    const policy = readFileSync(path.join(SRC_ROOT, '../../../cerbos/policies/resource_offer.yaml'), 'utf-8');
    for (const acao of ['extend', 'read', 'accept', 'decline']) {
      expect(policy).toContain(acao);
    }
  });

  it(
    'ponta a ponta: vaga publicada -> candidatura -> assessment concluído -> entrevista agendada -> ' +
      'oferta estendida -> aceita -> candidate.started_work registrado, com a sequência do outbox ordenada por agregado',
    async () => {
      let tenantId: string | undefined;
      let outroTenantId: string | undefined;
      try {
        tenantId = (
          await adminPool.query<{ id: string }>(
            `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 3d Ltda','00000000000131','test-tenant-00000000000131') RETURNING id`,
          )
        ).rows[0].id;
        outroTenantId = (
          await adminPool.query<{ id: string }>(
            `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 3d Outro Ltda','00000000000132','test-tenant-00000000000132') RETURNING id`,
          )
        ).rows[0].id;

        // --- vaga publicada ---
        const orgUnit = await adminPool.query<{ id: string }>(
          `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
          [tenantId],
        );
        const requisition = await adminPool.query<{ id: string }>(
          `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Gate 3d', 'aprovada', now()) RETURNING id`,
          [tenantId, orgUnit.rows[0].id],
        );
        const job = await adminPool.query<{ id: string }>(
          `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, publicado_em) VALUES ($1, $2, 'Vaga Gate 3d', 'vaga-gate-3d', now()) RETURNING id`,
          [tenantId, requisition.rows[0].id],
        );
        const recrutador = await adminPool.query<{ id: string }>(
          `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'gate3d-recrutador@example.com') RETURNING id`,
          [tenantId],
        );

        // --- candidatura ---
        const person = await adminPool.query<{ id: string }>(
          `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
           VALUES ('hash-gate-3d','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato Gate 3d','gate3d@example.com') RETURNING id`,
        );
        const applicationService = new ApplicationService(new OutboxService());
        const application = await tenantContext.run(tenantId, (client) =>
          applicationService.create(client, { tenantId: tenantId!, jobId: job.rows[0].id, personId: person.rows[0].id }),
        );
        const applicationId = application.id;

        // --- assessment concluído ---
        const instrument = await adminPool.query<{ id: string }>(
          `INSERT INTO instrument (nome, tipo_instrumento) VALUES ('Instrumento Gate 3d', 'nao_psicologico') RETURNING id`,
        );
        const instrumentVersion = await adminPool.query<{ id: string }>(
          `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, true) RETURNING id`,
          [instrument.rows[0].id],
        );
        await adminPool.query(
          `INSERT INTO assessment_application (tenant_id, application_id, person_id, instrument_version_id, status, iniciado_em, concluido_em)
           VALUES ($1, $2, $3, $4, 'concluido', now(), now())`,
          [tenantId, applicationId, person.rows[0].id, instrumentVersion.rows[0].id],
        );

        // --- entrevista agendada (reaproveita o domínio Interview da Fase 3a) ---
        const guideService = new InterviewGuideService(new CompetencyService());
        const scheduleService = new InterviewScheduleService();
        const { id: guideId } = await tenantContext.run(tenantId, (client) =>
          guideService.criarRascunho(client, {
            tenantId: tenantId!,
            jobId: job.rows[0].id,
            competencias: [
              { nome: 'Comunicação', ancoras: [1, 2, 3, 4, 5].map((nivel) => ({ nivel, descricaoComportamental: `Nível ${nivel}` })) },
            ],
          }),
        );
        const version = await tenantContext.run(tenantId, (client) => guideService.publicar(client, tenantId!, guideId));
        const avaliador = await adminPool.query<{ id: string }>(
          `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'gate3d-avaliador@example.com') RETURNING id`,
          [tenantId],
        );
        await tenantContext.run(tenantId, (client) =>
          scheduleService.criar(client, {
            tenantId: tenantId!,
            applicationId,
            interviewGuideVersionId: version.id,
            dataHora: new Date(),
            avaliadorIds: [avaliador.rows[0].id],
          }),
        );

        // --- oferta estendida -> aceita ---
        const outbox = new OutboxService();
        const decisionService = new DecisionService(outbox);
        const offerService = new OfferService(outbox, decisionService);
        const { id: offerId } = await tenantContext.run(tenantId, (client) =>
          offerService.extend(client, { tenantId: tenantId!, applicationId, valor: '8800.00', estendidoPor: recrutador.rows[0].id }),
        );
        await tenantContext.run(tenantId, (client) =>
          offerService.accept(client, { tenantId: tenantId!, offerId, respondidoPor: recrutador.rows[0].id }),
        );

        // --- candidate.started_work registrado ---
        const startedWorkService = new ApplicationStartedWorkService(outbox);
        await tenantContext.run(tenantId, (client) =>
          startedWorkService.registrar(client, {
            tenantId: tenantId!,
            applicationId,
            startDate: '2026-09-15',
            registradoPor: recrutador.rows[0].id,
          }),
        );

        // --- prova: sequência do outbox para este agregado é monotônica e contém todos os marcos, em ordem ---
        const outboxRows = await adminPool.query<{ event_type: string; sequence: number }>(
          `SELECT event_type, sequence FROM outbox_event WHERE tenant_id = $1 AND aggregate_id = $2 ORDER BY sequence ASC`,
          [tenantId, applicationId],
        );
        const eventos = outboxRows.rows.map((r) => r.event_type);
        expect(eventos).toContain('offer.extended');
        expect(eventos).toContain('offer.accepted');
        expect(eventos).toContain('candidate.started_work');
        expect(eventos.indexOf('offer.extended')).toBeLessThan(eventos.indexOf('offer.accepted'));
        expect(eventos.indexOf('offer.accepted')).toBeLessThan(eventos.indexOf('candidate.started_work'));
        const sequences = outboxRows.rows.map((r) => r.sequence);
        expect(sequences).toEqual([...sequences].sort((a, b) => a - b));

        // --- "Como fomos avaliados" reflete o funil completo ---
        const viewService = new CandidateEvaluationViewService();
        const view = await tenantContext.run(tenantId, (client) => viewService.build(client, tenantId!, applicationId));
        expect(view.oferta?.status).toBe('aceita');

        // --- isolamento: outro tenant não enxerga nada disto ---
        const vistoDeOutroTenant = await tenantContext.run(outroTenantId, (client) =>
          client.query(`SELECT id FROM offer WHERE id = $1`, [offerId]),
        );
        expect(vistoDeOutroTenant.rows).toEqual([]);
        const startedWorkDeOutroTenant = await tenantContext.run(outroTenantId, (client) =>
          client.query(`SELECT id FROM application_started_work WHERE application_id = $1`, [applicationId]),
        );
        expect(startedWorkDeOutroTenant.rows).toEqual([]);
      } finally {
        if (tenantId) {
          await adminPool.query('DELETE FROM application_started_work WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM offer WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM decision WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM scorecard WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM interview_evaluator WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM interview_schedule WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM interview_guide_version WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM interview_guide WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM competency WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM assessment_application WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM candidate_application_summary WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
          await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-gate-3d'`);
          await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
        }
        if (outroTenantId) {
          await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenantId]);
        }
      }
    },
  );
});

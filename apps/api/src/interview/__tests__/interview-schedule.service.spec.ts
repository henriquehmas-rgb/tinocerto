import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { InterviewScheduleService } from '../interview-schedule.service';

describe('InterviewScheduleService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const service = new InterviewScheduleService();

  let tenantId: string;
  let jobId: string;
  let applicationId: string;
  let guideVersionId: string;
  const uniqueCnpj = '00000000000036'; // Use unique CNPJ to avoid conflicts
  const uniqueSlug = 'test-interview-schedule-service-' + Date.now();
  const uniqueCpfHash = 'hash-schedule-' + Date.now();

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Interview Schedule Ltda','${uniqueCnpj}','${uniqueSlug}') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Schedule', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Schedule', 'vaga-schedule-0091') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;
    const guide = await adminPool.query<{ id: string }>(
      `INSERT INTO interview_guide (tenant_id, job_id, status, competencias_rascunho) VALUES ($1, $2, 'publicado', '[]'::jsonb) RETURNING id`,
      [tenantId, jobId],
    );
    const version = await adminPool.query<{ id: string }>(
      `INSERT INTO interview_guide_version (tenant_id, interview_guide_id, versao, competencias_snapshot) VALUES ($1, $2, 1, '[]'::jsonb) RETURNING id`,
      [tenantId, guide.rows[0].id],
    );
    guideVersionId = version.rows[0].id;
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('${uniqueCpfHash}', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Gustavo Schedule', 'gustavo.schedule@example.com')
       RETURNING id`,
    );
    const application = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id, etapa_funil) VALUES ($1, $2, $3, 'entrevista') RETURNING id`,
      [tenantId, jobId, person.rows[0].id],
    );
    applicationId = application.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM interview_schedule WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_evaluator WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person WHERE cpf_hash = $1', [uniqueCpfHash]);
    await adminPool.query('DELETE FROM interview_guide_version WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_guide WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  describe('obterPorCandidatura', () => {
    it('retorna null quando a candidatura não tem nenhum agendamento', async () => {
      const resultado = await tenantContext.run(tenantId, (client) =>
        service.obterPorCandidatura(client, tenantId, applicationId),
      );
      expect(resultado).toBeNull();
    });

    it('retorna o agendamento mais recente quando existe um', async () => {
      const { id: scheduleId } = await tenantContext.run(tenantId, (client) =>
        service.criar(client, {
          tenantId,
          applicationId,
          interviewGuideVersionId: guideVersionId,
          dataHora: new Date('2026-09-01T14:00:00Z'),
          avaliadorIds: [],
        }),
      );

      const resultado = await tenantContext.run(tenantId, (client) =>
        service.obterPorCandidatura(client, tenantId, applicationId),
      );

      expect(resultado).toEqual({ id: scheduleId, dataHora: new Date('2026-09-01T14:00:00Z'), status: 'agendada' });
    });
  });
});

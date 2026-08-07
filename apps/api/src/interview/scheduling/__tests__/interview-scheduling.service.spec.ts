import { Pool } from 'pg';
import { TenantContext } from '../../../database/tenant-context';
import { EnvelopeEncryptionService } from '../../../talent/envelope-encryption.service';
import { AuditLogService } from '../../../trust/audit-log.service';
import { OutboxService } from '../../../outbox/outbox.service';
import { ApplicationService } from '../../../hiring/application.service';
import { DatabaseService } from '../../../database/database.service';
import { CompetencyService } from '../../competency.service';
import { InterviewGuideService } from '../../interview-guide.service';
import { InterviewScheduleService } from '../../interview-schedule.service';
import { GoogleOAuthService } from '../google-oauth.service';
import { CalendarEventService } from '../calendar-event.service';
import { InterviewSchedulingService } from '../interview-scheduling.service';
import { EventoCalendarioResultado, GoogleCalendarClient } from '../google-calendar.types';

class CalendarClientFixo implements GoogleCalendarClient {
  async criarEvento(): Promise<EventoCalendarioResultado> {
    return { googleEventId: 'evento-scheduling-fake', googleMeetLink: 'https://meet.google.com/scheduling-fake' };
  }
}

function fakeDatabaseService(pool: Pool): DatabaseService {
  return { pool } as DatabaseService;
}

describe('InterviewSchedulingService — coordena agendamento + calendário best-effort', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);

  const oauthService = new GoogleOAuthService(new EnvelopeEncryptionService());
  const applicationService = new ApplicationService(new OutboxService());
  const auditLog = new AuditLogService();
  const guideService = new InterviewGuideService(new CompetencyService());
  const scheduleService = new InterviewScheduleService();

  let tenantId: string;
  let jobId: string;
  let applicationId: string;
  let organizadorId: string;
  let avaliadorId: string;
  let guideVersionId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Interview Scheduling Ltda','00000000000092','test-tenant-00000000000092') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Sched', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Sched', 'vaga-sched') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-scheduling','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato Scheduling','candidato-scheduling@example.com') RETURNING id`,
    );
    const application = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, jobId, person.rows[0].id],
    );
    applicationId = application.rows[0].id;
    const organizador = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'organizador-sched@example.com') RETURNING id`,
      [tenantId],
    );
    organizadorId = organizador.rows[0].id;
    const avaliador = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'avaliador-sched@example.com') RETURNING id`,
      [tenantId],
    );
    avaliadorId = avaliador.rows[0].id;

    const { id: guideId } = await tenantContext.run(tenantId, (client) =>
      guideService.criarRascunho(client, {
        tenantId,
        jobId,
        competencias: [
          {
            nome: 'Comunicação',
            ancoras: [1, 2, 3, 4, 5].map((nivel) => ({ nivel, descricaoComportamental: `Nível ${nivel}` })),
          },
        ],
      }),
    );
    const version = await tenantContext.run(tenantId, (client) => guideService.publicar(client, tenantId, guideId));
    guideVersionId = version.id;
  });

  afterEach(async () => {
    await adminPool.query('DELETE FROM interview_schedule_calendar_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_evaluator WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_schedule WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM google_calendar_connection WHERE tenant_id = $1', [tenantId]);
  });

  afterAll(async () => {
    // [Desvio do plano -- mesmo achado do Task 3] InterviewSchedulingService
    // .agendar() chama CalendarEventService.tentarCriarEvento internamente,
    // que grava audit_log_entry a cada chamada. Sem limpar antes do tenant,
    // DELETE FROM tenant viola audit_log_entry_tenant_id_fkey (sem ON
    // DELETE CASCADE).
    await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_guide_version WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_guide WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM competency WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-scheduling'`);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('cria interview_schedule + interview_evaluator mesmo sem organizador conectado (calendário é side-effect best-effort)', async () => {
    const calendarEventService = new CalendarEventService(
      oauthService,
      applicationService,
      auditLog,
      new CalendarClientFixo(),
      fakeDatabaseService(appPool),
    );
    const schedulingService = new InterviewSchedulingService(scheduleService, calendarEventService, fakeDatabaseService(appPool));

    const created = await schedulingService.agendar({
      tenantId,
      applicationId,
      interviewGuideVersionId: guideVersionId,
      dataHora: new Date(),
      avaliadorIds: [avaliadorId],
      organizadoPorUserId: organizadorId,
    });

    const schedule = await adminPool.query(`SELECT status FROM interview_schedule WHERE id = $1`, [created.id]);
    expect(schedule.rows[0].status).toBe('agendada');
    const evaluators = await adminPool.query(`SELECT user_id FROM interview_evaluator WHERE interview_schedule_id = $1`, [
      created.id,
    ]);
    expect(evaluators.rows.map((r) => r.user_id)).toEqual([avaliadorId]);

    const calendarRow = await adminPool.query(
      `SELECT status FROM interview_schedule_calendar_event WHERE interview_schedule_id = $1`,
      [created.id],
    );
    expect(calendarRow.rows[0].status).toBe('sem_conexao');
  });

  it('com organizador conectado, cria evento e usa o organizador correto (quem chamou agendar, não o primeiro avaliador)', async () => {
    await tenantContext.run(tenantId, (client) =>
      oauthService.salvarConexao(client, tenantId, organizadorId, {
        googleEmail: 'organizador-sched@gmail.com',
        refreshToken: 'token-valido',
      }),
    );
    const calendarEventService = new CalendarEventService(
      oauthService,
      applicationService,
      auditLog,
      new CalendarClientFixo(),
      fakeDatabaseService(appPool),
    );
    const schedulingService = new InterviewSchedulingService(scheduleService, calendarEventService, fakeDatabaseService(appPool));

    const created = await schedulingService.agendar({
      tenantId,
      applicationId,
      interviewGuideVersionId: guideVersionId,
      dataHora: new Date(),
      avaliadorIds: [avaliadorId],
      organizadoPorUserId: organizadorId,
    });

    const calendarRow = await adminPool.query(
      `SELECT status, organizador_user_id, google_event_id FROM interview_schedule_calendar_event WHERE interview_schedule_id = $1`,
      [created.id],
    );
    expect(calendarRow.rows[0].status).toBe('criado');
    expect(calendarRow.rows[0].organizador_user_id).toBe(organizadorId);
    expect(calendarRow.rows[0].organizador_user_id).not.toBe(avaliadorId);
    expect(calendarRow.rows[0].google_event_id).toBe('evento-scheduling-fake');
  });
});

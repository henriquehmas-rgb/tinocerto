import { Pool } from 'pg';
import { TenantContext } from '../../../database/tenant-context';
import { EnvelopeEncryptionService } from '../../../talent/envelope-encryption.service';
import { AuditLogService } from '../../../trust/audit-log.service';
import { OutboxService } from '../../../outbox/outbox.service';
import { ApplicationService } from '../../../hiring/application.service';
import { DatabaseService } from '../../../database/database.service';
import { GoogleOAuthService } from '../google-oauth.service';
import { CalendarEventService } from '../calendar-event.service';
import { EventoCalendarioResultado, GoogleCalendarClient } from '../google-calendar.types';

class CalendarClientFixo implements GoogleCalendarClient {
  async criarEvento(): Promise<EventoCalendarioResultado> {
    return { googleEventId: 'evento-fake-123', googleMeetLink: 'https://meet.google.com/fake-123' };
  }
}

class CalendarClientFalho implements GoogleCalendarClient {
  async criarEvento(): Promise<EventoCalendarioResultado> {
    throw new Error('Google Calendar fora do ar (simulado)');
  }
}

function fakeDatabaseService(pool: Pool): DatabaseService {
  return { pool } as DatabaseService;
}

describe('CalendarEventService — melhor esforço, nunca lança', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const oauthService = new GoogleOAuthService(new EnvelopeEncryptionService());
  const applicationService = new ApplicationService(new OutboxService());
  const auditLog = new AuditLogService();

  let tenantId: string;
  let jobId: string;
  let applicationId: string;
  let organizadorId: string;
  let avaliadorId: string;
  let guideVersionId: string;
  let scheduleId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Calendar Event Ltda','00000000000091','test-tenant-00000000000091') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Cal', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Cal', 'vaga-cal') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-calendar-event','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato Calendar','candidato-calendar@example.com') RETURNING id`,
    );
    const application = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, jobId, person.rows[0].id],
    );
    applicationId = application.rows[0].id;
    const organizador = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'organizador-cal@example.com') RETURNING id`,
      [tenantId],
    );
    organizadorId = organizador.rows[0].id;
    const avaliador = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'avaliador-cal@example.com') RETURNING id`,
      [tenantId],
    );
    avaliadorId = avaliador.rows[0].id;

    const guide = await adminPool.query<{ id: string }>(
      `INSERT INTO interview_guide (tenant_id, job_id, status, competencias_rascunho)
       VALUES ($1, $2, 'publicado', '[]') RETURNING id`,
      [tenantId, jobId],
    );
    const version = await adminPool.query<{ id: string }>(
      `INSERT INTO interview_guide_version (tenant_id, interview_guide_id, versao, competencias_snapshot)
       VALUES ($1, $2, 1, '[]') RETURNING id`,
      [tenantId, guide.rows[0].id],
    );
    guideVersionId = version.rows[0].id;
  });

  beforeEach(async () => {
    const schedule = await adminPool.query<{ id: string }>(
      `INSERT INTO interview_schedule (tenant_id, application_id, interview_guide_version_id, data_hora)
       VALUES ($1, $2, $3, now() + interval '1 day') RETURNING id`,
      [tenantId, applicationId, guideVersionId],
    );
    scheduleId = schedule.rows[0].id;
    await adminPool.query(
      `INSERT INTO interview_evaluator (tenant_id, interview_schedule_id, user_id) VALUES ($1, $2, $3)`,
      [tenantId, scheduleId, avaliadorId],
    );
  });

  afterEach(async () => {
    await adminPool.query('DELETE FROM interview_schedule_calendar_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_evaluator WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_schedule WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM google_calendar_connection WHERE tenant_id = $1', [tenantId]);
  });

  afterAll(async () => {
    // [Desvio do plano] CalendarEventService.tentarCriarEvento grava uma
    // linha em audit_log_entry (via AuditLogService.append) a cada chamada
    // -- os 3 testes acima chamam tentarCriarEvento diretamente, então este
    // tenant sempre termina com entradas em audit_log_entry. Sem este
    // DELETE, a linha `DELETE FROM tenant` abaixo viola
    // audit_log_entry_tenant_id_fkey (FK sem ON DELETE CASCADE) --
    // reproduzido ao vivo ao rodar o teste como o plano original
    // especificava (sem esta linha). audit_log_entry precisa ser limpo
    // ANTES do tenant, na ordem certa de dependência de FK.
    await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_guide_version WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_guide WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-calendar-event'`);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('organizador sem conexão -- grava status sem_conexao, nunca lança', async () => {
    const service = new CalendarEventService(
      oauthService,
      applicationService,
      auditLog,
      new CalendarClientFixo(),
      fakeDatabaseService(appPool),
    );
    await expect(
      service.tentarCriarEvento({
        tenantId,
        interviewScheduleId: scheduleId,
        applicationId,
        organizadoPorUserId: organizadorId,
        avaliadorIds: [avaliadorId],
        dataHora: new Date(),
      }),
    ).resolves.toBeUndefined();

    const row = await adminPool.query(
      `SELECT status FROM interview_schedule_calendar_event WHERE tenant_id = $1 AND interview_schedule_id = $2`,
      [tenantId, scheduleId],
    );
    expect(row.rows[0].status).toBe('sem_conexao');
  });

  it('organizador com conexão, API saudável -- cria evento e grava id + link do Meet', async () => {
    await tenantContext.run(tenantId, (client) =>
      oauthService.salvarConexao(client, tenantId, organizadorId, {
        googleEmail: 'organizador-cal@gmail.com',
        refreshToken: 'token-valido',
      }),
    );
    const service = new CalendarEventService(
      oauthService,
      applicationService,
      auditLog,
      new CalendarClientFixo(),
      fakeDatabaseService(appPool),
    );
    await service.tentarCriarEvento({
      tenantId,
      interviewScheduleId: scheduleId,
      applicationId,
      organizadoPorUserId: organizadorId,
      avaliadorIds: [avaliadorId],
      dataHora: new Date(),
    });

    const row = await adminPool.query(
      `SELECT status, google_event_id, google_meet_link FROM interview_schedule_calendar_event WHERE tenant_id = $1 AND interview_schedule_id = $2`,
      [tenantId, scheduleId],
    );
    expect(row.rows[0].status).toBe('criado');
    expect(row.rows[0].google_event_id).toBe('evento-fake-123');
    expect(row.rows[0].google_meet_link).toBe('https://meet.google.com/fake-123');
  });

  it('organizador com conexão, API do Google falha -- agendamento em si não é afetado, falha fica registrada', async () => {
    await tenantContext.run(tenantId, (client) =>
      oauthService.salvarConexao(client, tenantId, organizadorId, {
        googleEmail: 'organizador-cal@gmail.com',
        refreshToken: 'token-valido',
      }),
    );
    const service = new CalendarEventService(
      oauthService,
      applicationService,
      auditLog,
      new CalendarClientFalho(),
      fakeDatabaseService(appPool),
    );
    await expect(
      service.tentarCriarEvento({
        tenantId,
        interviewScheduleId: scheduleId,
        applicationId,
        organizadoPorUserId: organizadorId,
        avaliadorIds: [avaliadorId],
        dataHora: new Date(),
      }),
    ).resolves.toBeUndefined();

    const row = await adminPool.query(
      `SELECT status, erro FROM interview_schedule_calendar_event WHERE tenant_id = $1 AND interview_schedule_id = $2`,
      [tenantId, scheduleId],
    );
    expect(row.rows[0].status).toBe('falha');
    expect(row.rows[0].erro).toContain('Google Calendar fora do ar');

    // O interview_schedule em si continua intacto -- calendário é
    // side-effect best-effort, nunca dependência dura (decisão 6 da spec).
    const schedule = await adminPool.query(`SELECT status FROM interview_schedule WHERE id = $1`, [scheduleId]);
    expect(schedule.rows[0].status).toBe('agendada');
  });
});

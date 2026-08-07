import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { EnvelopeEncryptionService } from '../../talent/envelope-encryption.service';
import { AuditLogService } from '../../trust/audit-log.service';
import { OutboxService } from '../../outbox/outbox.service';
import { ApplicationService } from '../../hiring/application.service';
import { DatabaseService } from '../../database/database.service';
import { CompetencyService } from '../../interview/competency.service';
import { InterviewGuideService } from '../../interview/interview-guide.service';
import { InterviewScheduleService } from '../../interview/interview-schedule.service';
import { GoogleOAuthService } from '../../interview/scheduling/google-oauth.service';
import { CalendarEventService } from '../../interview/scheduling/calendar-event.service';
import { InterviewSchedulingService } from '../../interview/scheduling/interview-scheduling.service';
import { EventoCalendarioResultado, GoogleCalendarClient } from '../../interview/scheduling/google-calendar.types';

function listarArquivosDeProducao(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === '__tests__' || entrada === 'node_modules') continue;
    const completo = path.join(dir, entrada);
    const stat = statSync(completo);
    if (stat.isDirectory()) {
      listarArquivosDeProducao(completo, acc);
    } else if (entrada.endsWith('.ts') && !entrada.endsWith('.spec.ts')) {
      acc.push(completo);
    }
  }
  return acc;
}

function fakeDatabaseService(pool: Pool): DatabaseService {
  return { pool } as DatabaseService;
}

class CalendarClientFixo implements GoogleCalendarClient {
  async criarEvento(): Promise<EventoCalendarioResultado> {
    return { googleEventId: 'evento-gate-3b', googleMeetLink: 'https://meet.google.com/gate-3b' };
  }
}

class CalendarClientFalho implements GoogleCalendarClient {
  async criarEvento(): Promise<EventoCalendarioResultado> {
    throw new Error('Google Calendar indisponível (chaos test simulado)');
  }
}

describe('Gate consolidado — Fase 3b (Agendamento via Google Calendar)', () => {
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

  const SRC_ROOT = path.resolve(__dirname, '../..');

  afterAll(async () => {
    await adminPool.end();
    await appPool.end();
  });

  it.each(['google_calendar_connection', 'interview_schedule_calendar_event'])(
    '%s tem RLS FORCE+RESTRICTIVE com predicado NULLIF',
    async (tabela) => {
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
    },
  );

  it('as migrations da Fase 3b estão registradas no manifest, na ordem certa, depois da Fase 3a', () => {
    const manifest = JSON.parse(readFileSync(path.join(SRC_ROOT, '../migrations/manifest.json'), 'utf-8')) as {
      migrations: string[];
    };
    const esperadas = ['interview_0007__google_calendar_connection.sql', 'interview_0008__interview_schedule_calendar_event.sql'];
    const indices = esperadas.map((m) => manifest.migrations.indexOf(m));
    expect(indices.every((i) => i !== -1)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    const indiceScorecard3a = manifest.migrations.indexOf('interview_0006__scorecard.sql');
    expect(indiceScorecard3a).toBeGreaterThanOrEqual(0);
    expect(indices[0]).toBeGreaterThan(indiceScorecard3a);
  });

  it('nenhum arquivo de produção fora de interview/scheduling/ importa googleapis diretamente', () => {
    const arquivos = listarArquivosDeProducao(SRC_ROOT).filter(
      (f) => !f.includes(`${path.sep}interview${path.sep}scheduling${path.sep}`),
    );
    expect(arquivos.length).toBeGreaterThan(50);

    const padraoSdkDireto = /from\s+['"]googleapis['"]/;
    const ofensores = arquivos.filter((f) => padraoSdkDireto.test(readFileSync(f, 'utf-8')));
    expect(ofensores.map((f) => path.relative(SRC_ROOT, f))).toEqual([]);
  });

  it('InterviewScheduleService.criar (contrato da Fase 3a) segue com a mesma assinatura -- Fase 3b não o alterou', async () => {
    let tenantId: string | undefined;
    try {
      tenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 3b Contrato Ltda','00000000000093','test-tenant-00000000000093') RETURNING id`,
        )
      ).rows[0].id;
      const orgUnit = await adminPool.query<{ id: string }>(
        `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
        [tenantId],
      );
      const req = await adminPool.query<{ id: string }>(
        `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Contrato', 'aprovada', now()) RETURNING id`,
        [tenantId, orgUnit.rows[0].id],
      );
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Contrato', 'vaga-contrato-3b') RETURNING id`,
        [tenantId, req.rows[0].id],
      );
      const person = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-gate-3b-contrato','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato Gate 3b','gate3b-contrato@example.com') RETURNING id`,
      );
      const application = await adminPool.query<{ id: string }>(
        `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, job.rows[0].id, person.rows[0].id],
      );
      const avaliador = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'avaliador-contrato@example.com') RETURNING id`,
        [tenantId],
      );

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

      // Assinatura EXATA já documentada pela Fase 3a: criar(client, {tenantId,
      // applicationId, interviewGuideVersionId, dataHora, avaliadorIds}) ->
      // Promise<{id}>. Se este teste falhar por erro de tipo/compilação, é
      // sinal de que a Fase 3b alterou um contrato que deveria ter ficado
      // intocado (spec, decisão 9).
      const created = await tenantContext.run(tenantId, (client) =>
        scheduleService.criar(client, {
          tenantId: tenantId!,
          applicationId: application.rows[0].id,
          interviewGuideVersionId: version.id,
          dataHora: new Date(),
          avaliadorIds: [avaliador.rows[0].id],
        }),
      );
      expect(created.id).toBeDefined();
    } finally {
      if (tenantId) {
        await adminPool.query('DELETE FROM interview_evaluator WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_schedule WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_guide_version WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_guide WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM competency WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
        await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-gate-3b-contrato'`);
        await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
      }
    }
  });

  it('chaos test: queda simulada da API do Google Calendar não trava o agendamento -- degradação graciosa', async () => {
    let tenantId: string | undefined;
    let outroTenantId: string | undefined;
    try {
      tenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 3b E2E Ltda','00000000000094','test-tenant-00000000000094') RETURNING id`,
        )
      ).rows[0].id;
      outroTenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 3b E2E Outro Ltda','00000000000095','test-tenant-00000000000095') RETURNING id`,
        )
      ).rows[0].id;

      const orgUnit = await adminPool.query<{ id: string }>(
        `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
        [tenantId],
      );
      const req = await adminPool.query<{ id: string }>(
        `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Gate 3b', 'aprovada', now()) RETURNING id`,
        [tenantId, orgUnit.rows[0].id],
      );
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Gate 3b', 'vaga-gate-3b') RETURNING id`,
        [tenantId, req.rows[0].id],
      );
      const person = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-gate-3b','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato Gate 3b','gate3b@example.com') RETURNING id`,
      );
      const application = await adminPool.query<{ id: string }>(
        `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, job.rows[0].id, person.rows[0].id],
      );
      const organizador = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'organizador-gate@example.com') RETURNING id`,
        [tenantId],
      );
      const avaliador = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'avaliador-gate@example.com') RETURNING id`,
        [tenantId],
      );

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

      // Organizador COM conexão -- prova que mesmo tendo credencial válida,
      // uma API do Google fora do ar não derruba o agendamento.
      await tenantContext.run(tenantId, (client) =>
        oauthService.salvarConexao(client, tenantId!, organizador.rows[0].id, {
          googleEmail: 'organizador-gate@gmail.com',
          refreshToken: 'token-valido-gate',
        }),
      );

      const calendarEventServiceFalho = new CalendarEventService(
        oauthService,
        applicationService,
        auditLog,
        new CalendarClientFalho(),
        fakeDatabaseService(appPool),
      );
      const schedulingServiceFalho = new InterviewSchedulingService(
        scheduleService,
        calendarEventServiceFalho,
        fakeDatabaseService(appPool),
      );

      const created = await schedulingServiceFalho.agendar({
        tenantId: tenantId!,
        applicationId: application.rows[0].id,
        interviewGuideVersionId: version.id,
        dataHora: new Date(),
        avaliadorIds: [avaliador.rows[0].id],
        organizadoPorUserId: organizador.rows[0].id,
      });

      const schedule = await adminPool.query(`SELECT status FROM interview_schedule WHERE id = $1`, [created.id]);
      expect(schedule.rows[0].status).toBe('agendada');

      const calendarRow = await adminPool.query(
        `SELECT status, erro FROM interview_schedule_calendar_event WHERE interview_schedule_id = $1`,
        [created.id],
      );
      expect(calendarRow.rows[0].status).toBe('falha');
      expect(calendarRow.rows[0].erro).toContain('chaos test simulado');

      // Trocar o "provedor" (aqui, o cliente de calendário) por um saudável
      // e confirmar que o MESMO código de InterviewSchedulingService volta a
      // criar o evento normalmente -- prova a interface, não a
      // implementação (mesmo espírito do teste de troca de provedor do
      // Model Router na Fase 3a).
      const calendarEventServiceSaudavel = new CalendarEventService(
        oauthService,
        applicationService,
        auditLog,
        new CalendarClientFixo(),
        fakeDatabaseService(appPool),
      );
      const schedulingServiceSaudavel = new InterviewSchedulingService(
        scheduleService,
        calendarEventServiceSaudavel,
        fakeDatabaseService(appPool),
      );
      const created2 = await schedulingServiceSaudavel.agendar({
        tenantId: tenantId!,
        applicationId: application.rows[0].id,
        interviewGuideVersionId: version.id,
        dataHora: new Date(),
        avaliadorIds: [avaliador.rows[0].id],
        organizadoPorUserId: organizador.rows[0].id,
      });
      const calendarRow2 = await adminPool.query(
        `SELECT status, google_meet_link FROM interview_schedule_calendar_event WHERE interview_schedule_id = $1`,
        [created2.id],
      );
      expect(calendarRow2.rows[0].status).toBe('criado');
      expect(calendarRow2.rows[0].google_meet_link).toBe('https://meet.google.com/gate-3b');

      // Isolamento: outro tenant não enxerga nada deste agendamento nem do
      // evento de calendário (mesmo padrão de dois tenants da Fase 0).
      const vistoDeOutroTenant = await tenantContext.run(outroTenantId, (client) =>
        client.query(`SELECT id FROM interview_schedule WHERE id = ANY($1::uuid[])`, [[created.id, created2.id]]),
      );
      expect(vistoDeOutroTenant.rows).toEqual([]);
      const conexaoDeOutroTenant = await tenantContext.run(outroTenantId, (client) =>
        client.query(`SELECT tenant_id FROM google_calendar_connection WHERE tenant_id = $1`, [tenantId]),
      );
      expect(conexaoDeOutroTenant.rows).toEqual([]);
    } finally {
      if (tenantId) {
        // [Desvio do plano -- mesmo achado do Task 3/4] Este teste chama
        // agendar() duas vezes, cada uma acionando
        // CalendarEventService.registrar() -> AuditLogService.append(),
        // então este tenant sempre termina com linhas em audit_log_entry.
        // audit_log_entry_tenant_id_fkey não tem ON DELETE CASCADE --
        // precisa ser limpo ANTES do DELETE FROM tenant.
        await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_schedule_calendar_event WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_evaluator WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_schedule WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM google_calendar_connection WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_guide_version WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_guide WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM competency WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
        await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-gate-3b'`);
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
  });
});

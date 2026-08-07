import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { TenantContext } from '../../database/tenant-context';
import { AuditLogService } from '../../trust/audit-log.service';
import { ApplicationService } from '../../hiring/application.service';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleCalendarClient } from './google-calendar.types';

export interface TentarCriarEventoInput {
  tenantId: string;
  interviewScheduleId: string;
  applicationId: string;
  organizadoPorUserId: string;
  avaliadorIds: string[];
  dataHora: Date;
}

type ResultadoTentativa =
  | { status: 'criado'; googleEventId: string; googleMeetLink: string | null }
  | { status: 'sem_conexao' }
  | { status: 'falha'; erro: string };

const DURACAO_PADRAO_MINUTOS = 60;

@Injectable()
export class CalendarEventService {
  private readonly logger = new Logger(CalendarEventService.name);
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly oauthService: GoogleOAuthService,
    private readonly applicationService: ApplicationService,
    private readonly auditLog: AuditLogService,
    private readonly calendarClient: GoogleCalendarClient,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // NUNCA lança -- ver spec §Tratamento de erro. Toda saída possível
  // (sucesso, sem conexão, falha de API) grava uma linha em
  // interview_schedule_calendar_event e retorna void.
  async tentarCriarEvento(input: TentarCriarEventoInput): Promise<void> {
    try {
      const conexao = await this.tenantContext.run(input.tenantId, (client) =>
        this.oauthService.buscarConexao(client, input.tenantId, input.organizadoPorUserId),
      );

      if (!conexao) {
        await this.registrar(input, { status: 'sem_conexao' });
        this.logger.warn(
          `Organizador ${input.organizadoPorUserId} sem calendário Google conectado -- evento não criado para interview_schedule ${input.interviewScheduleId}`,
        );
        return;
      }

      const dadosEvento = await this.tenantContext.run(input.tenantId, async (client) => {
        const avaliadores = await client.query<{ email: string }>(
          `SELECT email FROM user_account WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [input.tenantId, input.avaliadorIds],
        );
        const candidato = await this.applicationService.findByIdWithPersonView(client, input.applicationId);
        const tenantRow = await client.query<{ timezone: string }>(`SELECT timezone FROM tenant WHERE id = $1`, [
          input.tenantId,
        ]);
        return {
          avaliadorEmails: avaliadores.rows.map((r) => r.email),
          candidatoEmail: candidato?.person.emailPrincipal ?? null,
          candidatoNome: candidato?.person.nome ?? 'Candidato',
          tenantTimeZone: tenantRow.rows[0]?.timezone ?? 'America/Sao_Paulo',
        };
      });

      const attendeeEmails = dadosEvento.candidatoEmail
        ? [...dadosEvento.avaliadorEmails, dadosEvento.candidatoEmail]
        : dadosEvento.avaliadorEmails;

      const resultado = await this.calendarClient.criarEvento(conexao.refreshToken, {
        resumo: `Entrevista — ${dadosEvento.candidatoNome}`,
        inicio: input.dataHora,
        duracaoMinutos: DURACAO_PADRAO_MINUTOS,
        timeZone: dadosEvento.tenantTimeZone,
        attendeeEmails,
      });

      await this.registrar(input, {
        status: 'criado',
        googleEventId: resultado.googleEventId,
        googleMeetLink: resultado.googleMeetLink,
      });
    } catch (err) {
      await this.registrar(input, { status: 'falha', erro: (err as Error).message });
      this.logger.error(
        `Falha ao criar evento de calendário para interview_schedule ${input.interviewScheduleId}`,
        err as Error,
      );
    }
  }

  private async registrar(input: TentarCriarEventoInput, resultado: ResultadoTentativa): Promise<void> {
    await this.tenantContext.run(input.tenantId, async (client) => {
      await client.query(
        `INSERT INTO interview_schedule_calendar_event
           (tenant_id, interview_schedule_id, organizador_user_id, status, google_event_id, google_meet_link, erro)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, interview_schedule_id) DO UPDATE
           SET status = EXCLUDED.status, google_event_id = EXCLUDED.google_event_id,
               google_meet_link = EXCLUDED.google_meet_link, erro = EXCLUDED.erro`,
        [
          input.tenantId,
          input.interviewScheduleId,
          input.organizadoPorUserId,
          resultado.status,
          resultado.status === 'criado' ? resultado.googleEventId : null,
          resultado.status === 'criado' ? resultado.googleMeetLink : null,
          resultado.status === 'falha' ? resultado.erro : null,
        ],
      );
      await this.auditLog.append(client, {
        tenantId: input.tenantId,
        actorType: 'system',
        action: resultado.status === 'criado' ? 'calendar.event_created' : 'calendar.event_not_created',
        resourceType: 'interview_schedule_calendar_event',
        resourceId: input.interviewScheduleId,
        occurredAt: new Date(),
      });
    });
  }
}

import { Body, Controller, ConflictException, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { JobRecrutadorService } from '../hiring/job-recrutador.service';
import { ScorecardService, ScorecardJaSubmetidoError } from './scorecard.service';

class SubmeterScorecardDto {
  @IsObject() notasPorCompetencia!: Record<string, number>;
  @IsOptional() @IsString() comentario?: string;
}

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

// Coarse gate aqui é sobre "interview_schedule" (posso ler esta
// entrevista?) -- a visibilidade FINA por linha de scorecard acontece
// dentro de ScorecardService.listarPorEntrevista, chamando CerbosService
// diretamente (ver comentário em scorecard.service.ts).
@Controller('v1/interview-schedules/:scheduleId/scorecards')
@UseGuards(CerbosGuard)
export class ScorecardController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly scorecardService: ScorecardService,
    private readonly jobRecrutadorService: JobRecrutadorService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // Item 3 da onda 3 de correção pós-revisão: nenhuma das 2 rotas deste
  // controller (submeter, listar) tinha guarda de posse por
  // job_recrutador -- um recrutador sem atribuição podia submeter/ler
  // scorecards de QUALQUER entrevista do tenant (a checagem por linha do
  // ScorecardService.listarPorEntrevista, comentada acima, é sobre QUEM
  // pode ver a nota de QUEM dentro de uma entrevista que o principal já
  // pode acessar -- não substitui a guarda coarse de posse pela vaga).
  // Resolve :scheduleId -> interview_schedule.application_id ->
  // application.job_id (via join direto -- não há um método dedicado em
  // ApplicationService/InterviewScheduleService para essa cadeia
  // específica) antes de checar posse.
  //
  // Exceção deliberada: o papel "entrevistador" é liberado pelo Cerbos
  // para create/read/update em interview_schedule (regra "gestao-
  // entrevista" de resource_interview_schedule.yaml) SEM NENHUMA relação
  // com job_recrutador -- avaliadores são atribuídos por ENTREVISTA
  // (tabela interview_evaluator, populada por InterviewScheduleService.criar
  // a partir de avaliadorIds), não por VAGA. job_recrutador só modela a
  // atribuição de RECRUTADORES a VAGAS. Aplicar esta guarda
  // incondicionalmente bloquearia com 404 um entrevistador legítimo (nunca
  // cadastrado em job_recrutador, nem deveria estar) tentando submeter ou
  // ler o próprio scorecard -- por isso pula a checagem quando o principal
  // tem o papel "entrevistador". Isso não reabre a lacuna que este item
  // fecha: o problema relatado na revisão foi "recrutador sem atribuição
  // acessa vaga de outro recrutador", um cenário exclusivo do papel
  // recrutador (escopado por vaga); entrevistador já era, por design, um
  // papel de escopo diferente (por entrevista), documentado desde a
  // criação deste controller (comentário "Coarse gate" acima).
  private async exigirPosseDaEntrevista(req: RequestWithAuthContext, scheduleId: string): Promise<void> {
    if (req.userRoles.includes('entrevistador')) {
      return;
    }
    await this.tenantContext.run(req.tenantId, async (client) => {
      const result = await client.query<{ job_id: string }>(
        `SELECT a.job_id
           FROM interview_schedule s
           JOIN application a ON a.tenant_id = s.tenant_id AND a.id = s.application_id
          WHERE s.tenant_id = $1 AND s.id = $2`,
        [req.tenantId, scheduleId],
      );
      if (result.rows.length === 0) {
        throw new NotFoundException(`interview_schedule ${scheduleId} não encontrada para o tenant`);
      }
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: result.rows[0].job_id,
        userId: req.userId,
        userRoles: req.userRoles,
      });
    });
  }

  @Post()
  @CerbosCheck('interview_schedule', 'update')
  async submeter(
    @Req() req: RequestWithAuthContext,
    @Param('scheduleId') scheduleId: string,
    @Body() dto: SubmeterScorecardDto,
  ) {
    await this.exigirPosseDaEntrevista(req, scheduleId);
    try {
      return await this.tenantContext.run(req.tenantId, (client) =>
        this.scorecardService.submeter(client, {
          tenantId: req.tenantId,
          interviewScheduleId: scheduleId,
          avaliadorId: req.userId,
          notasPorCompetencia: dto.notasPorCompetencia,
          comentario: dto.comentario,
        }),
      );
    } catch (err) {
      // [Fix 7 da revisão final] Reenvio após já ter submetido é um
      // conflito do cliente com o estado atual do recurso (409), não um
      // erro genérico de servidor (500).
      if (err instanceof ScorecardJaSubmetidoError) throw new ConflictException(err.message);
      throw err;
    }
  }

  @Get()
  @CerbosCheck('interview_schedule', 'read')
  async listar(@Req() req: RequestWithAuthContext, @Param('scheduleId') scheduleId: string) {
    await this.exigirPosseDaEntrevista(req, scheduleId);
    return this.tenantContext.run(req.tenantId, (client) =>
      this.scorecardService.listarPorEntrevista(client, req.tenantId, scheduleId, {
        id: req.userId,
        roles: req.userRoles,
      }),
    );
  }
}

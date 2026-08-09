import { Body, Controller, ConflictException, ForbiddenException, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { JobRecrutadorService } from '../hiring/job-recrutador.service';
import { ScorecardService, ScorecardJaSubmetidoError, AvaliadorNaoEhInterviewEvaluatorError } from './scorecard.service';

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
  // [Fix round 1 -- vulnerabilidade introduzida pela própria onda 3] A
  // versão anterior pulava esta checagem INTEIRA quando o principal tinha
  // o papel "entrevistador" (`if (...) return`). Isso era um BYPASS TOTAL,
  // não uma checagem alternativa: (a) um entrevistador sem NENHUMA relação
  // com esta entrevista específica conseguia ler/escrever scorecard de
  // QUALQUER entrevista do tenant; (b) um recrutador com papel duplo
  // ['recrutador','entrevistador'] (combinação comum no produto)
  // recuperava acesso irrestrito só por ter o segundo papel, revertendo a
  // guarda de posse por vaga para si mesmo. Confirmado explorável ao vivo.
  //
  // Correto: entrevistadores são atribuídos por ENTREVISTA (tabela
  // interview_evaluator, populada por InterviewScheduleService.criar a
  // partir de avaliadorIds), não por VAGA -- nunca deveriam estar em
  // job_recrutador. Por isso a checagem por vaga sozinha bloquearia com
  // 404 um entrevistador legítimo (comportamento pré-existente, correto).
  // A correção NÃO é pular a guarda -- é substituí-la por uma checagem OU:
  // permite se (posse por vaga via exigirAcesso) OU (existe uma linha em
  // interview_evaluator para ESTE scheduleId+userId específico). Tenta a
  // checagem de posse por vaga primeiro; se ela falhar (não lança direto),
  // só então tenta a checagem por interview_evaluator; só relança o erro
  // original (404) se AMBAS falharem. Isso fecha (a) e (b) acima: nenhum
  // dos dois caminhos é um "pula tudo" -- cada um autoriza no seu próprio
  // escopo (vaga inteira, ou esta entrevista específica).
  private async exigirPosseDaEntrevista(req: RequestWithAuthContext, scheduleId: string): Promise<void> {
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
      const jobId = result.rows[0].job_id;

      try {
        await this.jobRecrutadorService.exigirAcesso(client, {
          tenantId: req.tenantId,
          jobId,
          userId: req.userId,
          userRoles: req.userRoles,
        });
        return; // posse por vaga confirmada -- não precisa checar interview_evaluator
      } catch (errPosseVaga) {
        const evaluatorResult = await client.query(
          `SELECT 1 FROM interview_evaluator WHERE tenant_id = $1 AND interview_schedule_id = $2 AND user_id = $3`,
          [req.tenantId, scheduleId, req.userId],
        );
        if (evaluatorResult.rows.length > 0) {
          return; // é avaliador cadastrado DESTA entrevista específica -- autoriza
        }
        throw errPosseVaga; // nem posse por vaga, nem avaliador desta entrevista -- 404
      }
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
      // [Fix round 1 -- achado incidental da revisão] Violação do trigger
      // trg_scorecard_avaliador_e_evaluator (avaliador com posse da vaga
      // mas nunca designado avaliador desta entrevista específica) é um
      // erro de autorização do chamador (403), não um erro genérico de
      // servidor (500).
      if (err instanceof AvaliadorNaoEhInterviewEvaluatorError) throw new ForbiddenException(err.message);
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

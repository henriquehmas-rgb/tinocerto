import { Body, Controller, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsDateString, IsNotEmpty, IsString } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ApplicationService } from '../hiring/application.service';
import { JobRecrutadorService } from '../hiring/job-recrutador.service';
import { InterviewSchedulingService } from './scheduling/interview-scheduling.service';

class CriarAgendaDto {
  @IsString() @IsNotEmpty() applicationId!: string;
  @IsString() @IsNotEmpty() interviewGuideVersionId!: string;
  @IsDateString() dataHora!: string;
  @IsArray() avaliadorIds!: string[];
}

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/interview-schedules')
@UseGuards(CerbosGuard)
export class InterviewScheduleController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly schedulingService: InterviewSchedulingService,
    private readonly applicationService: ApplicationService,
    private readonly jobRecrutadorService: JobRecrutadorService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Post()
  @CerbosCheck('interview_schedule', 'create')
  async criar(@Req() req: RequestWithAuthContext, @Body() dto: CriarAgendaDto) {
    // Item 3 da onda 3 de correção pós-revisão: esta rota não tinha guarda
    // de posse por job_recrutador -- um recrutador sem atribuição podia
    // agendar entrevista para QUALQUER candidatura do tenant. CriarAgendaDto
    // já traz applicationId -- resolve applicationId -> job_id via
    // ApplicationService.findByIdWithPersonView (mesmo padrão de
    // application.controller.ts/adherence.controller.ts) antes de checar
    // posse.
    //
    // [Fix round 1 -- vulnerabilidade introduzida pela própria onda 3] A
    // versão anterior pulava esta guarda inteira quando o principal tinha
    // o papel "entrevistador" -- um bypass TOTAL (qualquer entrevistador,
    // mesmo sem nenhuma relação com a candidatura, conseguia agendar) que
    // também reabria acesso irrestrito para um recrutador com papel duplo
    // ['recrutador','entrevistador']. Diferente de
    // ScorecardController.exigirPosseDaEntrevista, aqui NÃO existe uma
    // checagem alternativa possível: este é o ato de CRIAR o agendamento,
    // então não há um interview_schedule prévio contra o qual checar
    // interview_evaluator, e avaliadorIds é um campo controlado pelo
    // próprio chamador no corpo da requisição -- um "sou avaliador"
    // auto-atestado aqui seria um controle inútil (o requisitante poderia
    // simplesmente se incluir em avaliadorIds para se autoautorizar). Por
    // isso a guarda de posse por vaga passa a ser incondicional: só quem
    // tem posse da vaga (via job_recrutador, ou papéis de acesso total)
    // pode criar um agendamento, mesmo que o principal também tenha o
    // papel "entrevistador".
    await this.tenantContext.run(req.tenantId, async (client) => {
      const view = await this.applicationService.findByIdWithPersonView(client, dto.applicationId);
      if (!view) {
        throw new NotFoundException(`Candidatura ${dto.applicationId} não encontrada`);
      }
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: view.jobId,
        userId: req.userId,
        userRoles: req.userRoles,
      });
    });

    // organizadoPorUserId é SEMPRE req.userId -- nunca um campo do corpo
    // da requisição (decisão 4 da spec: o organizador é quem está de fato
    // chamando esta rota, nunca algo que o cliente possa forjar).
    return this.schedulingService.agendar({
      tenantId: req.tenantId,
      applicationId: dto.applicationId,
      interviewGuideVersionId: dto.interviewGuideVersionId,
      dataHora: new Date(dto.dataHora),
      avaliadorIds: dto.avaliadorIds,
      organizadoPorUserId: req.userId,
    });
  }
}

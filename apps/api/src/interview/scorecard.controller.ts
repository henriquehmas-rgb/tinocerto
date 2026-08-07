import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { ScorecardService } from './scorecard.service';

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
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Post()
  @CerbosCheck('interview_schedule', 'update')
  async submeter(
    @Req() req: RequestWithAuthContext,
    @Param('scheduleId') scheduleId: string,
    @Body() dto: SubmeterScorecardDto,
  ) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.scorecardService.submeter(client, {
        tenantId: req.tenantId,
        interviewScheduleId: scheduleId,
        avaliadorId: req.userId,
        notasPorCompetencia: dto.notasPorCompetencia,
        comentario: dto.comentario,
      }),
    );
  }

  @Get()
  @CerbosCheck('interview_schedule', 'read')
  async listar(@Req() req: RequestWithAuthContext, @Param('scheduleId') scheduleId: string) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.scorecardService.listarPorEntrevista(client, req.tenantId, scheduleId, {
        id: req.userId,
        roles: req.userRoles,
      }),
    );
  }
}

import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsDateString, IsNotEmpty, IsString } from 'class-validator';
import { Request } from 'express';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
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
  constructor(private readonly schedulingService: InterviewSchedulingService) {}

  @Post()
  @CerbosCheck('interview_schedule', 'create')
  async criar(@Req() req: RequestWithAuthContext, @Body() dto: CriarAgendaDto) {
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

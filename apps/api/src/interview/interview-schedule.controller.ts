import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsDateString, IsNotEmpty, IsString } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { InterviewScheduleService } from './interview-schedule.service';

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
    private readonly scheduleService: InterviewScheduleService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Post()
  @CerbosCheck('interview_schedule', 'create')
  async criar(@Req() req: RequestWithAuthContext, @Body() dto: CriarAgendaDto) {
    return this.tenantContext.run(req.tenantId, (client) =>
      this.scheduleService.criar(client, {
        tenantId: req.tenantId,
        applicationId: dto.applicationId,
        interviewGuideVersionId: dto.interviewGuideVersionId,
        dataHora: new Date(dto.dataHora),
        avaliadorIds: dto.avaliadorIds,
      }),
    );
  }
}

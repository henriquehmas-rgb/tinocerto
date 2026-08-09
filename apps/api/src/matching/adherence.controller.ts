import { Controller, Get, NotFoundException, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CerbosGuard } from '../authz/cerbos.guard';
import { CerbosCheck } from '../authz/cerbos-check.decorator';
import { AdherenceService } from './adherence.service';
import { ApplicationService } from '../hiring/application.service';
import { JobRecrutadorService } from '../hiring/job-recrutador.service';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/applications')
@UseGuards(CerbosGuard)
export class AdherenceController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly adherenceService: AdherenceService,
    private readonly applicationService: ApplicationService,
    private readonly jobRecrutadorService: JobRecrutadorService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get(':id/adherence')
  @CerbosCheck('application', 'read')
  async porCandidatura(@Req() req: RequestWithAuthContext, @Param('id') id: string) {
    return this.tenantContext.run(req.tenantId, async (client) => {
      // C3 da revisão de coerência do Painel do Recrutador: o Cerbos
      // libera o papel "recrutador" para esta rota (mesma regra
      // "application"/"read"), mas até aqui não havia guarda de posse por
      // job_recrutador -- mesmo padrão já aplicado em
      // ApplicationController.findOne/assessmentReport: busca a view da
      // candidatura primeiro (para achar o jobId), exige posse, só então
      // delega ao service.
      const view = await this.applicationService.findByIdWithPersonView(client, id);
      if (!view) {
        throw new NotFoundException(`Candidatura ${id} não encontrada`);
      }
      await this.jobRecrutadorService.exigirAcesso(client, {
        tenantId: req.tenantId,
        jobId: view.jobId,
        userId: req.userId,
        userRoles: req.userRoles,
      });
      const score = await this.adherenceService.porCandidatura(client, id);
      if (!score) {
        throw new NotFoundException(`Candidatura ${id} não encontrada`);
      }
      return score;
    });
  }
}

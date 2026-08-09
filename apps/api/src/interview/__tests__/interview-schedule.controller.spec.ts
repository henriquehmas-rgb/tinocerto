import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InterviewScheduleController } from '../interview-schedule.controller';
import { InterviewSchedulingService } from '../scheduling/interview-scheduling.service';
import { ApplicationService } from '../../hiring/application.service';
import { JobRecrutadorService } from '../../hiring/job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('InterviewScheduleController', () => {
  const dto = { applicationId: 'application-1', interviewGuideVersionId: 'version-1', dataHora: '2026-09-01T10:00:00Z', avaliadorIds: [] };

  async function buildController(
    agendarMock: jest.Mock = jest.fn().mockResolvedValue({ id: 'schedule-1' }),
    // Guarda de posse por recrutador (onda 3 de correção pós-revisão) --
    // default: a candidatura existe (com jobId) e o requisitante tem
    // acesso. Os testes de guarda abaixo sobrescrevem esses mocks. Mesmo
    // padrão de AdherenceController.spec.ts.
    findByIdWithPersonViewMock: jest.Mock = jest.fn().mockResolvedValue({ id: 'application-1', jobId: 'job-1' }),
    exigirAcessoMock: jest.Mock = jest.fn().mockResolvedValue(undefined),
  ) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [InterviewScheduleController],
      providers: [
        { provide: InterviewSchedulingService, useValue: { agendar: agendarMock } },
        { provide: ApplicationService, useValue: { findByIdWithPersonView: findByIdWithPersonViewMock } },
        { provide: JobRecrutadorService, useValue: { exigirAcesso: exigirAcessoMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return moduleRef.get(InterviewScheduleController);
  }

  it('criar delega para schedulingService.agendar com organizadoPorUserId = req.userId quando o recrutador tem posse', async () => {
    const agendarMock = jest.fn().mockResolvedValue({ id: 'schedule-1' });
    const controller = await buildController(agendarMock);
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.criar(req, dto);

    expect(result).toEqual({ id: 'schedule-1' });
    expect(agendarMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', applicationId: 'application-1', organizadoPorUserId: 'user-1' }),
    );
  });

  it('criar pula a guarda de posse por vaga quando o principal tem o papel entrevistador', async () => {
    const agendarMock = jest.fn().mockResolvedValue({ id: 'schedule-1' });
    const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
    const controller = await buildController(agendarMock, undefined, exigirAcessoMock);
    const req = { tenantId: 'tenant-1', userId: 'entrevistador-1', userRoles: ['entrevistador'] } as any;

    await expect(controller.criar(req, dto)).resolves.toEqual({ id: 'schedule-1' });
    // Entrevistadores são atribuídos por ENTREVISTA (interview_evaluator),
    // não por VAGA -- nunca cadastrados em job_recrutador. Aplicar a
    // guarda aqui bloquearia incorretamente um entrevistador legítimo.
    expect(exigirAcessoMock).not.toHaveBeenCalled();
  });

  // Item 3 da onda 3 de correção pós-revisão: esta rota não tinha guarda
  // de posse por job_recrutador -- um recrutador sem atribuição podia
  // agendar entrevista para QUALQUER candidatura do tenant.
  describe('guarda de posse por recrutador (onda 3)', () => {
    it('lança NotFoundException quando a candidatura não existe (ou não é do tenant)', async () => {
      const agendarMock = jest.fn();
      const findByIdWithPersonViewMock = jest.fn().mockResolvedValue(null);
      const controller = await buildController(agendarMock, findByIdWithPersonViewMock);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.criar(req, dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(agendarMock).not.toHaveBeenCalled();
    });

    it('lança NotFoundException quando o recrutador não está atribuído à vaga da candidatura', async () => {
      const agendarMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController(agendarMock, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.criar(req, dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(agendarMock).not.toHaveBeenCalled();
      expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-1',
        jobId: 'job-1',
        userId: 'recrutador-nao-atribuido',
        userRoles: ['recrutador'],
      });
    });
  });
});

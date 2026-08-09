import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ScorecardController } from '../scorecard.controller';
import { ScorecardService } from '../scorecard.service';
import { JobRecrutadorService } from '../../hiring/job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('ScorecardController', () => {
  const submeterDto = { notasPorCompetencia: { comunicacao: 5 } };

  async function buildController(
    serviceMock: { submeter?: jest.Mock; listarPorEntrevista?: jest.Mock } = {},
    // Guarda de posse por recrutador (onda 3 de correção pós-revisão) --
    // default: o SELECT interview_schedule JOIN application encontra uma
    // linha (job_id), e o requisitante tem acesso. Os testes de guarda
    // abaixo sobrescrevem esses mocks. Mesmo padrão de fakeClient/fakePool
    // de InterviewGuideController.spec.ts.
    queryMock: jest.Mock = jest.fn().mockResolvedValue({ rows: [{ job_id: 'job-1' }] }),
    exigirAcessoMock: jest.Mock = jest.fn().mockResolvedValue(undefined),
  ) {
    const fakeClient = { query: queryMock, release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [ScorecardController],
      providers: [
        {
          provide: ScorecardService,
          useValue: {
            submeter: serviceMock.submeter ?? jest.fn(),
            listarPorEntrevista: serviceMock.listarPorEntrevista ?? jest.fn(),
          },
        },
        { provide: JobRecrutadorService, useValue: { exigirAcesso: exigirAcessoMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return moduleRef.get(ScorecardController);
  }

  it('submeter delega para scorecardService.submeter quando o recrutador tem posse da entrevista', async () => {
    const submeterMock = jest.fn().mockResolvedValue({ id: 'scorecard-1' });
    const controller = await buildController({ submeter: submeterMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.submeter(req, 'schedule-1', submeterDto);

    expect(result).toEqual({ id: 'scorecard-1' });
    expect(submeterMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ interviewScheduleId: 'schedule-1', avaliadorId: 'user-1' }),
    );
  });

  it('listar delega para scorecardService.listarPorEntrevista quando o recrutador tem posse da entrevista', async () => {
    const listarMock = jest.fn().mockResolvedValue([]);
    const controller = await buildController({ listarPorEntrevista: listarMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.listar(req, 'schedule-1');

    expect(result).toEqual([]);
    expect(listarMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'schedule-1', { id: 'user-1', roles: ['recrutador'] });
  });

  it('submeter/listar pulam a guarda de posse por vaga quando o principal tem o papel entrevistador', async () => {
    const submeterMock = jest.fn().mockResolvedValue({ id: 'scorecard-1' });
    const listarMock = jest.fn().mockResolvedValue([]);
    const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
    const controller = await buildController({ submeter: submeterMock, listarPorEntrevista: listarMock }, undefined, exigirAcessoMock);
    const req = { tenantId: 'tenant-1', userId: 'entrevistador-1', userRoles: ['entrevistador'] } as any;

    await expect(controller.submeter(req, 'schedule-1', submeterDto)).resolves.toEqual({ id: 'scorecard-1' });
    await expect(controller.listar(req, 'schedule-1')).resolves.toEqual([]);
    // Entrevistadores são atribuídos por ENTREVISTA (interview_evaluator),
    // não por VAGA -- nunca cadastrados em job_recrutador. A guarda de
    // posse por vaga bloquearia incorretamente um entrevistador legítimo
    // submetendo/lendo o próprio scorecard (a visibilidade fina por linha
    // já é responsabilidade de ScorecardService.listarPorEntrevista).
    expect(exigirAcessoMock).not.toHaveBeenCalled();
  });

  // Item 3 da onda 3 de correção pós-revisão: nenhuma das 2 rotas deste
  // controller (submeter, listar) tinha guarda de posse por
  // job_recrutador -- um recrutador sem atribuição podia submeter/ler
  // scorecards de QUALQUER entrevista do tenant.
  describe('guarda de posse por recrutador (onda 3)', () => {
    it('submeter lança NotFoundException quando o interview_schedule não existe para o tenant', async () => {
      const submeterMock = jest.fn();
      const queryMock = jest.fn().mockResolvedValue({ rows: [] });
      const controller = await buildController({ submeter: submeterMock }, queryMock);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.submeter(req, 'schedule-inexistente', submeterDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(submeterMock).not.toHaveBeenCalled();
    });

    it('submeter lança NotFoundException quando o recrutador não está atribuído à vaga da entrevista', async () => {
      const submeterMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ submeter: submeterMock }, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.submeter(req, 'schedule-1', submeterDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(submeterMock).not.toHaveBeenCalled();
      expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-1',
        jobId: 'job-1',
        userId: 'recrutador-nao-atribuido',
        userRoles: ['recrutador'],
      });
    });

    it('listar lança NotFoundException quando o interview_schedule não existe para o tenant', async () => {
      const listarMock = jest.fn();
      const queryMock = jest.fn().mockResolvedValue({ rows: [] });
      const controller = await buildController({ listarPorEntrevista: listarMock }, queryMock);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.listar(req, 'schedule-inexistente')).rejects.toBeInstanceOf(NotFoundException);
      expect(listarMock).not.toHaveBeenCalled();
    });

    it('listar lança NotFoundException quando o recrutador não está atribuído à vaga da entrevista', async () => {
      const listarMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ listarPorEntrevista: listarMock }, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.listar(req, 'schedule-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(listarMock).not.toHaveBeenCalled();
    });
  });
});

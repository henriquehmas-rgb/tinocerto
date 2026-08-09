import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CandidateSummaryController } from '../candidate-summary.controller';
import { CandidateSummaryService } from '../candidate-summary.service';
import { ApplicationService } from '../../hiring/application.service';
import { JobRecrutadorService } from '../../hiring/job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('CandidateSummaryController', () => {
  async function buildController(
    serviceMock: { gerar?: jest.Mock; obterAtual?: jest.Mock; aplicar?: jest.Mock } = {},
    // Guarda de posse por recrutador (Fase 5a, fix C3) -- default: a
    // candidatura existe (com jobId) e o requisitante tem acesso. Os
    // testes de guarda abaixo sobrescrevem esses mocks.
    findByIdWithPersonViewMock: jest.Mock = jest.fn().mockResolvedValue({ id: 'application-1', jobId: 'job-1' }),
    exigirAcessoMock: jest.Mock = jest.fn().mockResolvedValue(undefined),
  ) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [CandidateSummaryController],
      providers: [
        {
          provide: CandidateSummaryService,
          useValue: {
            gerar: serviceMock.gerar ?? jest.fn(),
            obterAtual: serviceMock.obterAtual ?? jest.fn(),
            aplicar: serviceMock.aplicar ?? jest.fn(),
          },
        },
        { provide: ApplicationService, useValue: { findByIdWithPersonView: findByIdWithPersonViewMock } },
        { provide: JobRecrutadorService, useValue: { exigirAcesso: exigirAcessoMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return moduleRef.get(CandidateSummaryController);
  }

  it('POST / delega para service.gerar quando o recrutador tem posse', async () => {
    const draft = { id: 'draft-1', applicationId: 'application-1', frases: [], criadoEm: new Date() };
    const gerarMock = jest.fn().mockResolvedValue(draft);
    const controller = await buildController({ gerar: gerarMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.gerar(req, 'application-1');

    expect(result).toEqual(draft);
    expect(gerarMock).toHaveBeenCalledWith({ tenantId: 'tenant-1', applicationId: 'application-1', actorId: 'user-1' });
  });

  it('GET current delega para service.obterAtual quando o recrutador tem posse', async () => {
    const draft = { id: 'draft-1', applicationId: 'application-1', frases: [], criadoEm: new Date() };
    const obterAtualMock = jest.fn().mockResolvedValue(draft);
    const controller = await buildController({ obterAtual: obterAtualMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.atual(req, 'application-1');

    expect(result).toEqual(draft);
    expect(obterAtualMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'application-1');
  });

  it('POST :draftId/apply delega para service.aplicar quando o recrutador tem posse', async () => {
    const aplicado = { ok: true };
    const aplicarMock = jest.fn().mockResolvedValue(aplicado);
    const controller = await buildController({ aplicar: aplicarMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.aplicar(req, 'application-1', 'draft-1');

    expect(result).toEqual(aplicado);
    expect(aplicarMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      applicationId: 'application-1',
      draftId: 'draft-1',
      actorId: 'user-1',
    });
  });

  // C3 da revisão de coerência do Painel do Recrutador: as 3 rotas deste
  // controller são liberadas pelo Cerbos para "recrutador", mas não havia
  // guarda de posse por job_recrutador.
  describe('guarda de posse por recrutador (Fase 5a, fix C3)', () => {
    it('POST / lança NotFoundException quando o recrutador não está atribuído à vaga', async () => {
      const gerarMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ gerar: gerarMock }, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.gerar(req, 'application-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(gerarMock).not.toHaveBeenCalled();
    });

    it('POST / lança NotFoundException quando a candidatura não existe', async () => {
      const gerarMock = jest.fn();
      const findByIdWithPersonViewMock = jest.fn().mockResolvedValue(null);
      const controller = await buildController({ gerar: gerarMock }, findByIdWithPersonViewMock);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.gerar(req, 'application-inexistente')).rejects.toBeInstanceOf(NotFoundException);
      expect(gerarMock).not.toHaveBeenCalled();
    });

    it('GET current lança NotFoundException quando o recrutador não está atribuído à vaga', async () => {
      const obterAtualMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ obterAtual: obterAtualMock }, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.atual(req, 'application-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(obterAtualMock).not.toHaveBeenCalled();
    });

    it('POST :draftId/apply lança NotFoundException quando o recrutador não está atribuído à vaga', async () => {
      const aplicarMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ aplicar: aplicarMock }, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.aplicar(req, 'application-1', 'draft-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(aplicarMock).not.toHaveBeenCalled();
    });
  });
});

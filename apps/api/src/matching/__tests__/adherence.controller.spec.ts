import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdherenceController } from '../adherence.controller';
import { AdherenceService } from '../adherence.service';
import { ApplicationService } from '../../hiring/application.service';
import { JobRecrutadorService } from '../../hiring/job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('AdherenceController', () => {
  async function buildController(
    porCandidaturaMock: jest.Mock,
    // Guarda de posse por recrutador (Fase 5a, fix C3) -- default: a
    // candidatura existe (com jobId) e o requisitante tem acesso. Os testes
    // de guarda abaixo sobrescrevem esses mocks.
    findByIdWithPersonViewMock: jest.Mock = jest.fn().mockResolvedValue({ id: 'application-1', jobId: 'job-1' }),
    exigirAcessoMock: jest.Mock = jest.fn().mockResolvedValue(undefined),
  ) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdherenceController],
      providers: [
        { provide: AdherenceService, useValue: { porCandidatura: porCandidaturaMock } },
        { provide: ApplicationService, useValue: { findByIdWithPersonView: findByIdWithPersonViewMock } },
        { provide: JobRecrutadorService, useValue: { exigirAcesso: exigirAcessoMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return moduleRef.get(AdherenceController);
  }

  it('GET :id/adherence devolve o score quando a candidatura existe', async () => {
    const score = { scoreAderencia: 50, skillsBatidas: ['TypeScript'], skillsFaltantes: ['PostgreSQL'], totalExigidas: 2 };
    const porCandidaturaMock = jest.fn().mockResolvedValue(score);
    const controller = await buildController(porCandidaturaMock);
    const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.porCandidatura(req, 'application-1');

    expect(result).toEqual(score);
    expect(porCandidaturaMock).toHaveBeenCalledWith(expect.anything(), 'application-1');
  });

  it('GET :id/adherence devolve 404 quando a candidatura não existe (ou não é do tenant)', async () => {
    const porCandidaturaMock = jest.fn();
    const findByIdWithPersonViewMock = jest.fn().mockResolvedValue(null);
    const controller = await buildController(porCandidaturaMock, findByIdWithPersonViewMock);
    const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as any;

    await expect(controller.porCandidatura(req, 'application-inexistente')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(porCandidaturaMock).not.toHaveBeenCalled();
  });

  it('GET :id/adherence devolve 404 quando a candidatura existe mas o adherenceService não encontra score', async () => {
    const porCandidaturaMock = jest.fn().mockResolvedValue(null);
    const controller = await buildController(porCandidaturaMock);
    const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as any;

    await expect(controller.porCandidatura(req, 'application-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  // C3 da revisão de coerência do Painel do Recrutador: Cerbos libera
  // "recrutador" para esta rota, mas não havia guarda de posse por
  // job_recrutador.
  describe('guarda de posse por recrutador (Fase 5a, fix C3)', () => {
    it('lança NotFoundException quando o recrutador não está atribuído à vaga da candidatura', async () => {
      const porCandidaturaMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController(porCandidaturaMock, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.porCandidatura(req, 'application-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(porCandidaturaMock).not.toHaveBeenCalled();
    });

    it('chama exigirAcesso com o jobId da candidatura antes de delegar ao adherenceService', async () => {
      const score = { scoreAderencia: 50, skillsBatidas: [], skillsFaltantes: [], totalExigidas: 0 };
      const porCandidaturaMock = jest.fn().mockResolvedValue(score);
      const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
      const controller = await buildController(porCandidaturaMock, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await controller.porCandidatura(req, 'application-1');

      expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-abc',
        jobId: 'job-1',
        userId: 'user-1',
        userRoles: ['recrutador'],
      });
    });
  });
});

import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdverseImpactController } from '../adverse-impact.controller';
import { AdverseImpactSnapshotService } from '../adverse-impact-snapshot.service';
import { JobRecrutadorService } from '../../hiring/job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('AdverseImpactController', () => {
  async function buildController(
    listarPorVagaMock: jest.Mock,
    // Guarda de posse por recrutador (Fase 5a, fix C3) -- default resolve
    // (não bloqueia) para não quebrar os testes pré-existentes abaixo, que
    // não exercitam a guarda; o teste de guarda abaixo passa seu próprio
    // mock rejeitado.
    exigirAcessoMock: jest.Mock = jest.fn().mockResolvedValue(undefined),
  ) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdverseImpactController],
      providers: [
        { provide: AdverseImpactSnapshotService, useValue: { listarPorVaga: listarPorVagaMock } },
        { provide: JobRecrutadorService, useValue: { exigirAcesso: exigirAcessoMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return moduleRef.get(AdverseImpactController);
  }

  it('GET :id/adverse-impact devolve as linhas do snapshot', async () => {
    const linhas = [{ etapa: 'triagem', grupoDemografico: 'genero:feminino', taxaSelecao: 1, razao4Quintos: 1, calculadoEm: new Date() }];
    const listarPorVagaMock = jest.fn().mockResolvedValue(linhas);
    const controller = await buildController(listarPorVagaMock);
    const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.porVaga(req, 'job-1');

    expect(result).toEqual(linhas);
    expect(listarPorVagaMock).toHaveBeenCalledWith(expect.anything(), 'job-1');
  });

  it('GET :id/adverse-impact devolve lista vazia quando não há dado suficiente, não erro', async () => {
    const listarPorVagaMock = jest.fn().mockResolvedValue([]);
    const controller = await buildController(listarPorVagaMock);
    const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.porVaga(req, 'job-sem-dado');

    expect(result).toEqual([]);
  });

  // C3 da revisão de coerência do Painel do Recrutador: Cerbos libera
  // "recrutador" para esta rota, mas não havia guarda de posse por
  // job_recrutador.
  describe('guarda de posse por recrutador (Fase 5a, fix C3)', () => {
    it('lança NotFoundException quando o recrutador não está atribuído à vaga', async () => {
      const listarPorVagaMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController(listarPorVagaMock, exigirAcessoMock);
      const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.porVaga(req, 'job-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(listarPorVagaMock).not.toHaveBeenCalled();
    });

    it('chama exigirAcesso com tenantId/jobId/userId/userRoles antes de delegar ao service', async () => {
      const listarPorVagaMock = jest.fn().mockResolvedValue([]);
      const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
      const controller = await buildController(listarPorVagaMock, exigirAcessoMock);
      const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await controller.porVaga(req, 'job-1');

      expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-abc',
        jobId: 'job-1',
        userId: 'user-1',
        userRoles: ['recrutador'],
      });
    });
  });
});

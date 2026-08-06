import { Test } from '@nestjs/testing';
import { AdverseImpactController } from '../adverse-impact.controller';
import { AdverseImpactSnapshotService } from '../adverse-impact-snapshot.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('AdverseImpactController', () => {
  async function buildController(listarPorVagaMock: jest.Mock) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdverseImpactController],
      providers: [
        { provide: AdverseImpactSnapshotService, useValue: { listarPorVaga: listarPorVagaMock } },
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
});

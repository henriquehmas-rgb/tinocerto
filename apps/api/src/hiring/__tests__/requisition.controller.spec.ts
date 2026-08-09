import { Test } from '@nestjs/testing';
import { RequisitionController } from '../requisition.controller';
import { RequisitionService } from '../requisition.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('RequisitionController', () => {
  it('POST / delega para RequisitionService.open dentro de TenantContext', async () => {
    const openMock = jest.fn().mockResolvedValue({ id: 'req-novo-1' });
    // TenantContext (Fase 0, Task 5) não é mockado aqui -- o controller
    // instancia um TenantContext real a partir de databaseService.pool no
    // construtor, então .run() de fato chama pool.connect()/query()/release().
    // Só RequisitionService.open é mockado; o client passado a ele é o
    // client fake abaixo, casando com expect.anything() na asserção.
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [RequisitionController],
      providers: [
        { provide: RequisitionService, useValue: { open: openMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const controller = moduleRef.get(RequisitionController);
    const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.create(req, { orgUnitId: 'org-1', titulo: 'Vaga X' });

    expect(result).toEqual({ id: 'req-novo-1' });
    expect(openMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-abc',
      orgUnitId: 'org-1',
      titulo: 'Vaga X',
    });
  });

  // C3 da revisão de coerência do Painel do Recrutador: sem esta rota, o
  // formulário de criar vaga não tinha como descobrir o id de nenhuma
  // requisição existente (nem sequer a que o onboarding agora cria).
  it('GET / delega para RequisitionService.listar com o tenantId da requisição', async () => {
    const listarMock = jest
      .fn()
      .mockResolvedValue([{ id: 'req-1', titulo: 'Requisição inicial', status: 'aprovada' }]);
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [RequisitionController],
      providers: [
        { provide: RequisitionService, useValue: { listar: listarMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const controller = moduleRef.get(RequisitionController);
    const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.listar(req);

    expect(result).toEqual([{ id: 'req-1', titulo: 'Requisição inicial', status: 'aprovada' }]);
    expect(listarMock).toHaveBeenCalledWith(expect.anything(), 'tenant-abc');
  });
});

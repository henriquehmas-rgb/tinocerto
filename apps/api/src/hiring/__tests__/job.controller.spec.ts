import { Test } from '@nestjs/testing';
import { JobController } from '../job.controller';
import { JobService } from '../job.service';
import { JobRecrutadorService } from '../job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('JobController', () => {
  async function buildController(
    jobServiceMock: Partial<Record<keyof JobService, jest.Mock>>,
    jobRecrutadorServiceMock: Partial<Record<keyof JobRecrutadorService, jest.Mock>> = {},
  ) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [JobController],
      providers: [
        { provide: JobService, useValue: jobServiceMock },
        { provide: JobRecrutadorService, useValue: jobRecrutadorServiceMock },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();
    return moduleRef.get(JobController);
  }

  it('GET / delega para jobService.listar com tenantId/userId/userRoles da requisição', async () => {
    const listarMock = jest
      .fn()
      .mockResolvedValue([{ id: 'job-1', titulo: 'Vaga X', publicadoEm: null, criadoEm: new Date() }]);
    const controller = await buildController({ listar: listarMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.list(req);

    expect(listarMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      userId: 'user-1',
      userRoles: ['recrutador'],
    });
    expect(result).toHaveLength(1);
  });

  it('POST :id/actions/atribuir-recrutadores delega para jobRecrutadorService.exigirAcesso e atribuir', async () => {
    const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
    const atribuirMock = jest.fn().mockResolvedValue(undefined);
    const controller = await buildController({}, { exigirAcesso: exigirAcessoMock, atribuir: atribuirMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['admin_tenant'] } as any;

    const result = await controller.atribuirRecrutadores(req, 'job-1', { recrutadorIds: ['r1', 'r2'] });

    expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      userId: 'user-1',
      userRoles: ['admin_tenant'],
    });
    expect(atribuirMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      recrutadorIds: ['r1', 'r2'],
    });
    expect(result).toEqual({ id: 'job-1', recrutadorIds: ['r1', 'r2'] });
  });

  it('PATCH :id delega para jobRecrutadorService.exigirAcesso e jobService.editar', async () => {
    const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
    const editarMock = jest.fn().mockResolvedValue(undefined);
    const controller = await buildController({ editar: editarMock }, { exigirAcesso: exigirAcessoMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['gestor_vaga'] } as any;

    const result = await controller.editar(req, 'job-1', {
      titulo: 'Novo Título',
      descricao: 'Nova descrição',
      habilidadesExigidas: ['SQL'],
    });

    expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      userId: 'user-1',
      userRoles: ['gestor_vaga'],
    });
    expect(editarMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      titulo: 'Novo Título',
      descricao: 'Nova descrição',
      habilidadesExigidas: ['SQL'],
    });
    expect(result).toEqual({ id: 'job-1' });
  });
});

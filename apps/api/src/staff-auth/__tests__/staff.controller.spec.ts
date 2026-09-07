import { Test } from '@nestjs/testing';
import { StaffController } from '../staff.controller';
import { StaffAccountService } from '../staff-account.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('StaffController', () => {
  async function buildController(staffAccountServiceMock: Partial<Record<keyof StaffAccountService, jest.Mock>>) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [StaffController],
      providers: [
        { provide: StaffAccountService, useValue: staffAccountServiceMock },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();
    return moduleRef.get(StaffController);
  }

  it('GET / delega para staffAccountService.listarEquipe com o tenantId da requisição', async () => {
    const listarEquipeMock = jest.fn().mockResolvedValue([{ id: 'u1', email: 'ana@empresa.example', papeis: ['recrutador'] }]);
    const controller = await buildController({ listarEquipe: listarEquipeMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.listar(req);

    expect(listarEquipeMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1');
    expect(result).toEqual([{ id: 'u1', email: 'ana@empresa.example', papeis: ['recrutador'] }]);
  });
});

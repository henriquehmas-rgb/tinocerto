import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdherenceController } from '../adherence.controller';
import { AdherenceService } from '../adherence.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('AdherenceController', () => {
  async function buildController(porCandidaturaMock: jest.Mock) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdherenceController],
      providers: [
        { provide: AdherenceService, useValue: { porCandidatura: porCandidaturaMock } },
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
    const porCandidaturaMock = jest.fn().mockResolvedValue(null);
    const controller = await buildController(porCandidaturaMock);
    const req = { tenantId: 'tenant-abc', userId: 'user-1', userRoles: ['recrutador'] } as any;

    await expect(controller.porCandidatura(req, 'application-inexistente')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

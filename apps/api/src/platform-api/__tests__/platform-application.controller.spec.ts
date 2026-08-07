import { Test } from '@nestjs/testing';
import { PlatformApplicationController } from '../platform-application.controller';
import { ApplicationService } from '../../hiring/application.service';
import { DatabaseService } from '../../database/database.service';
import { ApiKeyGuard } from '../api-key.guard';
import { CerbosGuard } from '../../authz/cerbos.guard';
import { encodeCursor } from '../cursor-pagination';

describe('PlatformApplicationController', () => {
  async function buildController(listByCursorMock: jest.Mock) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [PlatformApplicationController],
      providers: [
        { provide: ApplicationService, useValue: { listByCursor: listByCursorMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();
    return moduleRef.get(PlatformApplicationController);
  }

  it('mapeia o resultado interno (camelCase) para o contrato público (snake_case) e monta next_cursor', async () => {
    const criadoEm = new Date('2026-08-07T12:00:00.000Z');
    const listByCursorMock = jest.fn().mockResolvedValue({
      items: [{ id: 'app-1', jobId: 'job-1', candidateId: 'cand-1', stage: 'triagem', createdAt: criadoEm }],
      hasMore: true,
    });
    const controller = await buildController(listByCursorMock);
    const req = { tenantId: 'tenant-abc' } as any;

    const result = await controller.list(req, { limit: 25 } as any);

    expect(result.data).toEqual([{ id: 'app-1', job_id: 'job-1', candidate_id: 'cand-1', stage: 'triagem', created_at: '2026-08-07T12:00:00.000Z' }]);
    expect(result.has_more).toBe(true);
    expect(result.next_cursor).toBe(encodeCursor({ sortValue: '2026-08-07T12:00:00.000Z', id: 'app-1' }));
    expect(listByCursorMock).toHaveBeenCalledWith(expect.anything(), {
      jobId: undefined,
      stage: undefined,
      limit: 25,
      cursor: undefined,
    });
  });

  it('sem mais páginas, next_cursor é null', async () => {
    const listByCursorMock = jest.fn().mockResolvedValue({ items: [], hasMore: false });
    const controller = await buildController(listByCursorMock);
    const result = await controller.list({ tenantId: 't' } as any, { limit: 25 } as any);
    expect(result.next_cursor).toBeNull();
  });

  it('decodifica o parâmetro cursor e repassa ao serviço', async () => {
    const listByCursorMock = jest.fn().mockResolvedValue({ items: [], hasMore: false });
    const controller = await buildController(listByCursorMock);
    const cursor = encodeCursor({ sortValue: '2026-08-01T00:00:00.000Z', id: 'app-0' });

    await controller.list({ tenantId: 't' } as any, { limit: 25, cursor } as any);

    expect(listByCursorMock).toHaveBeenCalledWith(expect.anything(), {
      jobId: undefined,
      stage: undefined,
      limit: 25,
      cursor: { sortValue: '2026-08-01T00:00:00.000Z', id: 'app-0' },
    });
  });
});

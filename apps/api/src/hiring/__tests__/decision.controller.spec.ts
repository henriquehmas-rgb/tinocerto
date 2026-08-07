import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { DecisionController } from '../decision.controller';
import { DecisionService } from '../decision.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('DecisionController', () => {
  // [Fase 3d, mesmo achado do offer.controller.spec.ts, Task 3] TenantContext.run
  // chama pool.connect() de verdade mesmo com DecisionService mockado --
  // precisa ser um Pool real conectável, fechado em afterEach, senão o
  // processo Jest não encerra sozinho ("did not exit") por causa do handle
  // TCP aberto.
  let pool: Pool;

  afterEach(async () => {
    await pool.end();
  });

  it('revisoesPendentes delega para DecisionService.listarRevisoesPendentes com o tenant do requisitante', async () => {
    const listarMock = jest.fn().mockResolvedValue([{ id: 'decision-1' }]);
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const moduleRef = await Test.createTestingModule({
      controllers: [DecisionController],
      providers: [
        { provide: DecisionService, useValue: { listarRevisoesPendentes: listarMock } },
        { provide: DatabaseService, useValue: { pool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const controller = moduleRef.get(DecisionController);
    const result = await controller.revisoesPendentes({ tenantId: 'tenant-1' } as any);

    expect(result).toEqual([{ id: 'decision-1' }]);
    expect(listarMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1');
  });
});

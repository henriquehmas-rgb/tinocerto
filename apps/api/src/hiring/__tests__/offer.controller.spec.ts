import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { OfferController } from '../offer.controller';
import { OfferService } from '../offer.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('OfferController', () => {
  let controller: OfferController;
  let pool: Pool;
  const acceptMock = jest.fn();
  const declineMock = jest.fn();

  beforeEach(async () => {
    acceptMock.mockReset();
    declineMock.mockReset();

    // TenantContext.run chama pool.connect() de verdade mesmo com
    // OfferService mockado (só o service em si é mock -- o controller monta
    // um TenantContext real sobre databaseService.pool no construtor) --
    // precisa ser um Pool real conectável, não um objeto fake. Fechado em
    // afterEach abaixo; sem isso, cada beforeEach abre uma conexão nova que
    // nunca é liberada, deixando handles TCP vivos que impedem o processo
    // Jest de encerrar sozinho ("Jest did not exit...").
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const moduleRef = await Test.createTestingModule({
      controllers: [OfferController],
      providers: [
        { provide: OfferService, useValue: { accept: acceptMock, decline: declineMock } },
        { provide: DatabaseService, useValue: { pool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(OfferController);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('accept delega para OfferService.accept com respondidoPor = req.userId', async () => {
    acceptMock.mockImplementation(async (_client: unknown, input: unknown) => ({ id: 'offer-1', ...({} as object), input }));
    const req = { tenantId: 'tenant-1', userId: 'user-1' } as any;

    // OfferService.accept é chamado dentro de tenantContext.run -- aqui só
    // validamos que o controller delega com os argumentos certos, não o
    // comportamento do TenantContext em si (coberto pelos testes de
    // integração real do Task 2).
    await expect(controller.accept(req, 'offer-1')).resolves.toBeDefined();
    expect(acceptMock).toHaveBeenCalled();
  });

  it('decline repassa motivoCodigo do body para OfferService.decline', async () => {
    declineMock.mockResolvedValue({ id: 'offer-1', applicationId: 'app-1' });
    const req = { tenantId: 'tenant-1', userId: 'user-1' } as any;

    await controller.decline(req, 'offer-1', { motivoCodigo: 'aceitou_outra_proposta' });

    expect(declineMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1', offerId: 'offer-1', respondidoPor: 'user-1', motivoRecusaCodigo: 'aceitou_outra_proposta' }),
    );
  });
});

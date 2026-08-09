import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { OfferController } from '../offer.controller';
import { OfferService } from '../offer.service';
import { JobRecrutadorService } from '../job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('OfferController', () => {
  let controller: OfferController;
  let pool: Pool;
  const acceptMock = jest.fn();
  const declineMock = jest.fn();
  const buscarJobIdMock = jest.fn();
  const exigirAcessoMock = jest.fn();

  beforeEach(async () => {
    acceptMock.mockReset();
    declineMock.mockReset();
    buscarJobIdMock.mockReset().mockResolvedValue('job-1');
    exigirAcessoMock.mockReset().mockResolvedValue(undefined);

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
        { provide: OfferService, useValue: { accept: acceptMock, decline: declineMock, buscarJobId: buscarJobIdMock } },
        { provide: JobRecrutadorService, useValue: { exigirAcesso: exigirAcessoMock } },
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
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    // OfferService.accept é chamado dentro de tenantContext.run -- aqui só
    // validamos que o controller delega com os argumentos certos, não o
    // comportamento do TenantContext em si (coberto pelos testes de
    // integração real do Task 2).
    await expect(controller.accept(req, 'offer-1')).resolves.toBeDefined();
    expect(acceptMock).toHaveBeenCalled();
    expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      userId: 'user-1',
      userRoles: ['recrutador'],
    });
  });

  it('decline repassa motivoCodigo do body para OfferService.decline', async () => {
    declineMock.mockResolvedValue({ id: 'offer-1', applicationId: 'app-1' });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    await controller.decline(req, 'offer-1', { motivoCodigo: 'aceitou_outra_proposta' });

    expect(declineMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1', offerId: 'offer-1', respondidoPor: 'user-1', motivoRecusaCodigo: 'aceitou_outra_proposta' }),
    );
  });

  // Item 1 (Critical) da onda 3 de correção pós-revisão: accept/decline
  // não chamavam JobRecrutadorService.exigirAcesso -- um recrutador sem
  // atribuição podia aceitar/recusar a oferta de QUALQUER candidatura do
  // tenant.
  describe('guarda de posse por recrutador (onda 3)', () => {
    it('accept lança NotFoundException quando a oferta não existe (offer.id -> job_id não resolve)', async () => {
      buscarJobIdMock.mockResolvedValue(null);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.accept(req, 'offer-inexistente')).rejects.toBeInstanceOf(NotFoundException);
      expect(acceptMock).not.toHaveBeenCalled();
      expect(exigirAcessoMock).not.toHaveBeenCalled();
    });

    it('accept lança NotFoundException quando o recrutador não está atribuído à vaga da oferta', async () => {
      exigirAcessoMock.mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.accept(req, 'offer-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(acceptMock).not.toHaveBeenCalled();
      expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-1',
        jobId: 'job-1',
        userId: 'recrutador-nao-atribuido',
        userRoles: ['recrutador'],
      });
    });

    it('decline lança NotFoundException quando a oferta não existe (offer.id -> job_id não resolve)', async () => {
      buscarJobIdMock.mockResolvedValue(null);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.decline(req, 'offer-inexistente', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(declineMock).not.toHaveBeenCalled();
      expect(exigirAcessoMock).not.toHaveBeenCalled();
    });

    it('decline lança NotFoundException quando o recrutador não está atribuído à vaga da oferta', async () => {
      exigirAcessoMock.mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.decline(req, 'offer-1', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(declineMock).not.toHaveBeenCalled();
    });
  });
});

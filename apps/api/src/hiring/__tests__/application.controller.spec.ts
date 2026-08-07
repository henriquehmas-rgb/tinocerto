import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ApplicationController } from '../application.controller';
import { ApplicationService } from '../application.service';
import { PipelineStageTransitionService } from '../pipeline-stage-transition.service';
import { DecisionService } from '../decision.service';
import { OfferService } from '../offer.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('ApplicationController', () => {
  async function buildController(
    moveStageMock: jest.Mock,
    recordMock: jest.Mock = jest.fn(),
    offerServiceMock: { extend?: jest.Mock; listByApplication?: jest.Mock } = {},
  ) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [ApplicationController],
      providers: [
        { provide: ApplicationService, useValue: { findByIdWithPersonView: jest.fn() } },
        { provide: PipelineStageTransitionService, useValue: { moveStage: moveStageMock } },
        // DecisionService (Task 12) não é exercitado pelos testes de
        // move-stage -- mock vazio só para satisfazer o construtor do
        // controller, que agora exige a dependência. Os testes de reject
        // abaixo passam seu próprio recordMock.
        { provide: DecisionService, useValue: { record: recordMock } },
        // OfferService (Fase 3d, Task 3) -- mock vazio por padrão para
        // satisfazer o construtor nos testes de move-stage/reject que não
        // exercitam extend-offer/offers; os testes de extend-offer/offers
        // abaixo passam seus próprios mocks de extend/listByApplication.
        {
          provide: OfferService,
          useValue: { extend: offerServiceMock.extend ?? jest.fn(), listByApplication: offerServiceMock.listByApplication ?? jest.fn() },
        },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return moduleRef.get(ApplicationController);
  }

  it('POST :id/actions/move-stage delega para PipelineStageTransitionService.moveStage quando x-user-id é um UUID válido', async () => {
    const moveStageMock = jest.fn().mockResolvedValue({ id: 'transition-1' });
    const controller = await buildController(moveStageMock);
    const req = {
      tenantId: 'tenant-abc',
      userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      userRoles: ['recrutador'],
    } as any;

    const result = await controller.moveStage(req, 'application-1', { toState: 'entrevista', reasonCode: 'ok' });

    expect(result).toEqual({ id: 'transition-1' });
    expect(moveStageMock).toHaveBeenCalledWith(expect.anything(), {
      applicationId: 'application-1',
      toState: 'entrevista',
      reasonCode: 'ok',
      actorId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      actorType: 'user',
    });
  });

  it('POST :id/actions/move-stage rejeita com 400 quando x-user-id não é um UUID (evita 500 do Postgres 22P02 em actor_id)', async () => {
    const moveStageMock = jest.fn();
    const controller = await buildController(moveStageMock);
    // Mesmo literal não-UUID usado nos fixtures de teste desta fase
    // (Task 6 guard specs, ex.: 'user-1'/'recrutador-1') -- exatamente o
    // caso que causava 22P02 sem esta validação.
    const req = { tenantId: 'tenant-abc', userId: 'recrutador-1', userRoles: ['recrutador'] } as any;

    await expect(
      controller.moveStage(req, 'application-1', { toState: 'entrevista', reasonCode: 'ok' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(moveStageMock).not.toHaveBeenCalled();
  });

  it('POST :id/actions/reject traduz violação da FK composta cross-tenant (23503) em 404 em vez de vazar como 500', async () => {
    // Achado de revisão adversarial do Task 12: o CerbosGuard (Task 6) monta
    // resource.attr.tenant_id a partir do próprio req.tenantId do
    // requisitante, nunca de um lookup real do tenant dono de `:id` -- então
    // um reject cross-tenant nunca é bloqueado no Cerbos e chega até aqui.
    // Quem de fato impede a escrita é a FK composta
    // fk_decision_tenant_application; este teste trava que o erro dela é
    // traduzido para um 404 limpo, não deixado vazar como 500 não tratado.
    const pgForeignKeyError = Object.assign(new Error('insert or update on table "decision" violates foreign key constraint "fk_decision_tenant_application"'), {
      code: '23503',
      constraint: 'fk_decision_tenant_application',
    });
    const recordMock = jest.fn().mockRejectedValue(pgForeignKeyError);
    const moveStageMock = jest.fn();
    const controller = await buildController(moveStageMock, recordMock);
    const req = { tenantId: 'tenant-abc', userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userRoles: ['recrutador'] } as any;

    await expect(
      controller.reject(req, 'application-de-outro-tenant', { motivoCodigo: 'perfil_nao_aderente' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('POST :id/actions/reject NÃO intercepta erros que não sejam a violação de fk_decision_tenant_application', async () => {
    // Guarda contra um catch amplo demais: só a violação exata da FK
    // composta cross-tenant deve virar 404; qualquer outro erro (ex.: falha
    // de conexão, outra constraint) deve seguir subindo sem ser mascarado.
    const outraFalha = new Error('conexão com o banco perdida');
    const recordMock = jest.fn().mockRejectedValue(outraFalha);
    const moveStageMock = jest.fn();
    const controller = await buildController(moveStageMock, recordMock);
    const req = { tenantId: 'tenant-abc', userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userRoles: ['recrutador'] } as any;

    await expect(
      controller.reject(req, 'application-1', { motivoCodigo: 'perfil_nao_aderente' }),
    ).rejects.toBe(outraFalha);
  });

  // [Fase 3d, Task 3] extend-offer / offers. Nota de desvio do plano: o
  // esqueleto original deste describe (plano, Task 3 Step 6) descrevia
  // fixtures reais via adminPool (tenant/org_unit/... + TestingModule com
  // OfferService REAL) -- mas este arquivo, como já escrito antes desta
  // fase, é uma suíte de unidade do controller com TODOS os serviços
  // mockados (ver buildController acima); não existe nenhum precedente de
  // bootstrap de app HTTP real (supertest) ou de fixture Postgres neste
  // arquivo especificamente, e a disciplina do projeto (documentada em
  // offer.controller.spec.ts, Task 3) é mockar só na fronteira de
  // transporte, nunca lógica de domínio/banco -- o comportamento real de
  // banco/outbox de extend-offer já está integralmente coberto por
  // offer.service.spec.ts (Task 2) e pelo gate consolidado (Task 7). Os
  // testes abaixo seguem a convenção real deste arquivo (mock de
  // OfferService) em vez do esqueleto do plano. Por esse mesmo motivo, o
  // caso "valor inválido rejeitado pelo ValidationPipe (400)" do esqueleto
  // do plano foi omitido -- chamar o método do controller diretamente (como
  // todo teste deste arquivo faz) nunca passa pelo pipeline HTTP/pipes do
  // Nest, então não há como exercitar validação de DTO por este caminho;
  // nenhum teste existente no projeto inteiro bootstrapa um app HTTP real
  // (grep por supertest/INestApplication.listen não encontra nenhum uso).
  describe('extend-offer / offers (Fase 3d)', () => {
    it('POST :id/actions/extend-offer traduz violação da FK composta cross-tenant (fk_offer_tenant_application) em 404', async () => {
      const pgForeignKeyError = Object.assign(
        new Error('insert or update on table "offer" violates foreign key constraint "fk_offer_tenant_application"'),
        { code: '23503', constraint: 'fk_offer_tenant_application' },
      );
      const extendMock = jest.fn().mockRejectedValue(pgForeignKeyError);
      const moveStageMock = jest.fn();
      const controller = await buildController(moveStageMock, jest.fn(), { extend: extendMock });
      const req = { tenantId: 'tenant-abc', userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userRoles: ['recrutador'] } as any;

      await expect(controller.extendOffer(req, 'application-de-outro-tenant', { valor: '8500.00' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('POST :id/actions/extend-offer traduz OfertaPendenteExistenteError em 409', async () => {
      const { OfertaPendenteExistenteError } = await import('../offer.service');
      const extendMock = jest.fn().mockRejectedValue(new OfertaPendenteExistenteError('oferta pendente'));
      const moveStageMock = jest.fn();
      const controller = await buildController(moveStageMock, jest.fn(), { extend: extendMock });
      const req = { tenantId: 'tenant-abc', userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userRoles: ['recrutador'] } as any;

      await expect(controller.extendOffer(req, 'application-1', { valor: '9000.00' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('POST :id/actions/extend-offer delega para OfferService.extend com o valor e estendidoPor = req.userId', async () => {
      const extendMock = jest.fn().mockResolvedValue({ id: 'offer-1' });
      const moveStageMock = jest.fn();
      const controller = await buildController(moveStageMock, jest.fn(), { extend: extendMock });
      const req = { tenantId: 'tenant-abc', userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userRoles: ['recrutador'] } as any;

      const result = await controller.extendOffer(req, 'application-1', { valor: '8500.00' });

      expect(result).toEqual({ id: 'offer-1' });
      expect(extendMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-abc',
        applicationId: 'application-1',
        valor: '8500.00',
        estendidoPor: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      });
    });

    it('GET :id/offers delega para OfferService.listByApplication e devolve a lista', async () => {
      const listByApplicationMock = jest.fn().mockResolvedValue([{ id: 'offer-1', status: 'estendida' }]);
      const moveStageMock = jest.fn();
      const controller = await buildController(moveStageMock, jest.fn(), { listByApplication: listByApplicationMock });
      const req = { tenantId: 'tenant-abc', userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userRoles: ['recrutador'] } as any;

      const result = await controller.listOffers(req, 'application-1');

      expect(result).toEqual([{ id: 'offer-1', status: 'estendida' }]);
      expect(listByApplicationMock).toHaveBeenCalledWith(expect.anything(), 'tenant-abc', 'application-1');
    });
  });
});

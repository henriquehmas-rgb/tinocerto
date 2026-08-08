import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ApplicationController } from '../application.controller';
import { ApplicationService } from '../application.service';
import { PipelineStageTransitionService } from '../pipeline-stage-transition.service';
import { DecisionService } from '../decision.service';
import { OfferService } from '../offer.service';
import { ApplicationStartedWorkService } from '../application-started-work.service';
import { JobRecrutadorService } from '../job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';
import { ReportService } from '../../assessment/report/report.service';
import { AdherenceService } from '../../matching/adherence.service';

describe('ApplicationController', () => {
  async function buildController(
    moveStageMock: jest.Mock,
    recordMock: jest.Mock = jest.fn(),
    offerServiceMock: { extend?: jest.Mock; listByApplication?: jest.Mock } = {},
    startedWorkServiceMock: { registrar?: jest.Mock } = {},
    // JobRecrutadorService.exigirAcesso (Task 2/4) -- guarda de posse por
    // recrutador em findOne/moveStage. Default resolve (não bloqueia) para
    // não quebrar os testes pré-existentes acima que não exercitam a
    // guarda; os testes de guarda abaixo passam seu próprio mock rejeitado.
    exigirAcessoMock: jest.Mock = jest.fn().mockResolvedValue(undefined),
    // Mocks extras (Task 4): permitem sobrescrever o ApplicationService
    // padrão (usado por findOne/moveStage/assessmentReport para localizar
    // application.jobId) e injetar ReportService/AdherenceService para o
    // teste de GET :id/assessment-report.
    extraServiceMocks: {
      applicationServiceMock?: { findByIdWithPersonView?: jest.Mock };
      reportServiceMock?: { gerar?: jest.Mock };
      adherenceServiceMock?: { porCandidatura?: jest.Mock };
    } = {},
  ) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [ApplicationController],
      providers: [
        {
          provide: ApplicationService,
          useValue:
            extraServiceMocks.applicationServiceMock ?? {
              // Default resolve com um jobId presente -- necessário porque
              // findOne/moveStage agora sempre buscam application.jobId
              // antes de delegar; os testes pré-existentes de
              // moveStage/reject/extend-offer/offers/mark-started-work não
              // se importam com o conteúdo da view, só que ela exista.
              findByIdWithPersonView: jest.fn().mockResolvedValue({ id: 'application-1', jobId: 'job-1' }),
            },
        },
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
        // ApplicationStartedWorkService (Fase 3d, Task 4) -- mesmo padrão:
        // mock vazio por padrão, os testes de mark-started-work abaixo
        // passam seu próprio mock de registrar.
        { provide: ApplicationStartedWorkService, useValue: { registrar: startedWorkServiceMock.registrar ?? jest.fn() } },
        { provide: JobRecrutadorService, useValue: { exigirAcesso: exigirAcessoMock } },
        { provide: ReportService, useValue: extraServiceMocks.reportServiceMock ?? { gerar: jest.fn() } },
        { provide: AdherenceService, useValue: extraServiceMocks.adherenceServiceMock ?? { porCandidatura: jest.fn() } },
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

  // [Fase 3d, Task 4] mark-started-work. Mesmo desvio/motivo documentado no
  // describe de extend-offer acima: não há fixture-based Postgres neste
  // arquivo, o comportamento real de banco/outbox de
  // ApplicationStartedWorkService.registrar já está coberto por
  // application-started-work.service.spec.ts (Task 4) e pelo gate
  // consolidado (Task 7); estes testes só verificam o roteamento HTTP e a
  // tradução de erro de domínio para status code.
  describe('mark-started-work (Fase 3d)', () => {
    it('POST :id/actions/mark-started-work delega para ApplicationStartedWorkService.registrar com startDate e registradoPor = req.userId', async () => {
      const registrarMock = jest.fn().mockResolvedValue({ id: 'started-work-1' });
      const moveStageMock = jest.fn();
      const controller = await buildController(moveStageMock, jest.fn(), {}, { registrar: registrarMock });
      const req = { tenantId: 'tenant-abc', userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userRoles: ['recrutador'] } as any;

      const result = await controller.markStartedWork(req, 'application-1', { startDate: '2026-09-01' });

      expect(result).toEqual({ id: 'started-work-1' });
      expect(registrarMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-abc',
        applicationId: 'application-1',
        startDate: '2026-09-01',
        registradoPor: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      });
    });

    it('POST :id/actions/mark-started-work traduz NenhumaOfertaAceitaError em 409', async () => {
      const { NenhumaOfertaAceitaError } = await import('../application-started-work.service');
      const registrarMock = jest.fn().mockRejectedValue(new NenhumaOfertaAceitaError('sem oferta aceita'));
      const moveStageMock = jest.fn();
      const controller = await buildController(moveStageMock, jest.fn(), {}, { registrar: registrarMock });
      const req = { tenantId: 'tenant-abc', userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userRoles: ['recrutador'] } as any;

      await expect(controller.markStartedWork(req, 'application-1', { startDate: '2026-09-01' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('POST :id/actions/mark-started-work traduz InicioTrabalhoJaRegistradoError em 409', async () => {
      const { InicioTrabalhoJaRegistradoError } = await import('../application-started-work.service');
      const registrarMock = jest.fn().mockRejectedValue(new InicioTrabalhoJaRegistradoError('já registrado'));
      const moveStageMock = jest.fn();
      const controller = await buildController(moveStageMock, jest.fn(), {}, { registrar: registrarMock });
      const req = { tenantId: 'tenant-abc', userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', userRoles: ['recrutador'] } as any;

      await expect(controller.markStartedWork(req, 'application-1', { startDate: '2026-09-01' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  // [Fase 5a, Task 4] Guarda de posse por recrutador em GET :id e
  // POST :id/actions/move-stage: um recrutador só pode ver/mover
  // candidaturas de vagas às quais está atribuído (ou tem papel de acesso
  // total). A guarda em si (quem tem acesso a qual vaga) já é testada
  // exaustivamente em job-recrutador.service.spec.ts (Task 2); aqui só
  // travamos que o controller consulta application.jobId via
  // findByIdWithPersonView e propaga a rejeição de exigirAcesso sem
  // executar a ação protegida.
  describe('guarda de posse por recrutador (Fase 5a)', () => {
    it('GET :id lança NotFoundException quando o recrutador não está atribuído à vaga da candidatura', async () => {
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController(jest.fn(), undefined, {}, {}, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.findOne(req, 'application-1')).rejects.toThrow(NotFoundException);
    });

    it('POST :id/actions/move-stage lança NotFoundException quando o recrutador não está atribuído', async () => {
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const moveStageMock = jest.fn();
      const controller = await buildController(moveStageMock, undefined, {}, {}, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(
        controller.moveStage(req, 'application-1', { toState: 'entrevista' } as any),
      ).rejects.toThrow(NotFoundException);
      expect(moveStageMock).not.toHaveBeenCalled();
    });

    it('GET :id retorna a view da candidatura quando o recrutador tem acesso', async () => {
      const applicationServiceMock = {
        findByIdWithPersonView: jest.fn().mockResolvedValue({ id: 'application-1', jobId: 'job-1', etapaFunil: 'triagem' }),
      };
      const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
      const controller = await buildController(jest.fn(), undefined, {}, {}, exigirAcessoMock, { applicationServiceMock });
      const req = { tenantId: 'tenant-1', userId: 'recrutador-1', userRoles: ['recrutador'] } as any;

      const result = await controller.findOne(req, 'application-1');

      expect(result).toEqual({ id: 'application-1', jobId: 'job-1', etapaFunil: 'triagem' });
      expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-1',
        jobId: 'job-1',
        userId: 'recrutador-1',
        userRoles: ['recrutador'],
      });
    });

    it('GET :id lança NotFoundException quando a candidatura não existe (sem sequer chamar exigirAcesso)', async () => {
      const applicationServiceMock = { findByIdWithPersonView: jest.fn().mockResolvedValue(null) };
      const exigirAcessoMock = jest.fn();
      const controller = await buildController(jest.fn(), undefined, {}, {}, exigirAcessoMock, { applicationServiceMock });
      const req = { tenantId: 'tenant-1', userId: 'recrutador-1', userRoles: ['recrutador'] } as any;

      await expect(controller.findOne(req, 'application-inexistente')).rejects.toBeInstanceOf(NotFoundException);
      expect(exigirAcessoMock).not.toHaveBeenCalled();
    });
  });

  // [Fase 5a, Task 4] GET :id/assessment-report: combina o relatório por
  // dimensão (Fase 2a, ReportService.gerar) com o score de aderência
  // (Fase 2b, AdherenceService.porCandidatura). O relatório só é gerado
  // quando existe um result_grant vivo (não revogado/expirado, com consent
  // válido) para a candidatura -- sem grant, relatorio é null mas aderencia
  // continua sendo calculada (aderência de skills não depende de consent de
  // laudo).
  describe('GET :id/assessment-report (Fase 5a)', () => {
    it('retorna relatório por dimensão + score de aderência', async () => {
      const applicationServiceMock = {
        findByIdWithPersonView: jest.fn().mockResolvedValue({ id: 'app-1', jobId: 'job-1', person: { id: 'person-1' } }),
      };
      const reportServiceMock = { gerar: jest.fn().mockResolvedValue({ assessmentResultId: 'ar-1', secoes: [] }) };
      const adherenceServiceMock = {
        porCandidatura: jest.fn().mockResolvedValue({ scoreAderencia: 0.8, skillsBatidas: [], skillsFaltantes: [], totalExigidas: 0 }),
      };
      const controller = await buildController(jest.fn(), undefined, {}, {}, jest.fn(), {
        applicationServiceMock,
        reportServiceMock,
        adherenceServiceMock,
      });
      const req = { tenantId: 'tenant-1', userId: 'admin-1', userRoles: ['admin_tenant'] } as any;

      const result = await controller.assessmentReport(req, 'app-1');

      expect(result.aderencia?.scoreAderencia).toBe(0.8);
    });

    it('lança NotFoundException quando a candidatura não existe', async () => {
      const applicationServiceMock = { findByIdWithPersonView: jest.fn().mockResolvedValue(null) };
      const controller = await buildController(jest.fn(), undefined, {}, {}, jest.fn(), { applicationServiceMock });
      const req = { tenantId: 'tenant-1', userId: 'admin-1', userRoles: ['admin_tenant'] } as any;

      await expect(controller.assessmentReport(req, 'app-inexistente')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lança NotFoundException quando o recrutador não está atribuído à vaga da candidatura', async () => {
      const applicationServiceMock = {
        findByIdWithPersonView: jest.fn().mockResolvedValue({ id: 'app-1', jobId: 'job-1', person: { id: 'person-1' } }),
      };
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController(jest.fn(), undefined, {}, {}, exigirAcessoMock, { applicationServiceMock });
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.assessmentReport(req, 'app-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('relatorio é null quando não existe result_grant vivo, mas aderência ainda é calculada', async () => {
      const applicationServiceMock = {
        findByIdWithPersonView: jest.fn().mockResolvedValue({ id: 'app-1', jobId: 'job-1', person: { id: 'person-1' } }),
      };
      const reportServiceMock = { gerar: jest.fn() };
      const adherenceServiceMock = {
        porCandidatura: jest.fn().mockResolvedValue({ scoreAderencia: 0.5, skillsBatidas: [], skillsFaltantes: [], totalExigidas: 2 }),
      };
      const controller = await buildController(jest.fn(), undefined, {}, {}, jest.fn(), {
        applicationServiceMock,
        reportServiceMock,
        adherenceServiceMock,
      });
      const req = { tenantId: 'tenant-1', userId: 'admin-1', userRoles: ['admin_tenant'] } as any;

      const result = await controller.assessmentReport(req, 'app-1');

      // fakeClient.query (default do buildController) resolve { rows: [] }
      // -- ou seja, nenhum result_grant encontrado -- então gerar() não
      // deve nem ser chamado, e relatorio deve ser null.
      expect(reportServiceMock.gerar).not.toHaveBeenCalled();
      expect(result.relatorio).toBeNull();
      expect(result.aderencia?.scoreAderencia).toBe(0.5);
    });
  });
});

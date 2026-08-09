import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ScorecardController } from '../scorecard.controller';
import { ScorecardService, AvaliadorNaoEhInterviewEvaluatorError, ScorecardJaSubmetidoError } from '../scorecard.service';
import { JobRecrutadorService } from '../../hiring/job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('ScorecardController', () => {
  const submeterDto = { notasPorCompetencia: { comunicacao: 5 } };

  // fakeClient.query e chamado tanto pelas queries "de negocio" do
  // controller quanto pelos comandos de transacao de TenantContext.run
  // (BEGIN / set_config / COMMIT / ROLLBACK) -- distinguir por CONTEUDO do
  // SQL (em vez de ordem posicional de chamada) e o unico jeito robusto de
  // simular as duas queries reais (job_id do schedule, depois
  // interview_evaluator) sem acoplar o teste a quantas chamadas de
  // transacao o TenantContext emite por baixo dos panos.
  function makeQueryImpl(opts: { jobLookup?: { rows: unknown[] }; evaluatorLookup?: { rows: unknown[] } } = {}) {
    const jobLookup = opts.jobLookup ?? { rows: [{ job_id: 'job-1' }] };
    const evaluatorLookup = opts.evaluatorLookup ?? { rows: [] };
    return jest.fn((sql: string) => {
      if (typeof sql === 'string' && sql.includes('FROM interview_schedule s')) return Promise.resolve(jobLookup);
      if (typeof sql === 'string' && sql.includes('FROM interview_evaluator')) return Promise.resolve(evaluatorLookup);
      return Promise.resolve({ rows: [] }); // BEGIN / set_config / COMMIT / ROLLBACK
    });
  }

  async function buildController(opts: {
    serviceMock?: { submeter?: jest.Mock; listarPorEntrevista?: jest.Mock };
    queryImpl?: jest.Mock;
    exigirAcessoMock?: jest.Mock;
  } = {}) {
    const { serviceMock = {}, exigirAcessoMock = jest.fn().mockResolvedValue(undefined) } = opts;
    const queryMock = opts.queryImpl ?? makeQueryImpl();
    const fakeClient = { query: queryMock, release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [ScorecardController],
      providers: [
        {
          provide: ScorecardService,
          useValue: {
            submeter: serviceMock.submeter ?? jest.fn(),
            listarPorEntrevista: serviceMock.listarPorEntrevista ?? jest.fn(),
          },
        },
        { provide: JobRecrutadorService, useValue: { exigirAcesso: exigirAcessoMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return { controller: moduleRef.get(ScorecardController), queryMock, exigirAcessoMock };
  }

  it('submeter delega para scorecardService.submeter quando o recrutador tem posse da vaga da entrevista', async () => {
    const submeterMock = jest.fn().mockResolvedValue({ id: 'scorecard-1' });
    const { controller } = await buildController({ serviceMock: { submeter: submeterMock } });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.submeter(req, 'schedule-1', submeterDto);

    expect(result).toEqual({ id: 'scorecard-1' });
    expect(submeterMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ interviewScheduleId: 'schedule-1', avaliadorId: 'user-1' }),
    );
  });

  it('listar delega para scorecardService.listarPorEntrevista quando o recrutador tem posse da vaga da entrevista', async () => {
    const listarMock = jest.fn().mockResolvedValue([]);
    const { controller } = await buildController({ serviceMock: { listarPorEntrevista: listarMock } });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.listar(req, 'schedule-1');

    expect(result).toEqual([]);
    expect(listarMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'schedule-1', { id: 'user-1', roles: ['recrutador'] });
  });

  // Item 1 do "Fix round 1" (correcao da vulnerabilidade introduzida pela
  // propria onda 3): o bypass `if (userRoles.includes('entrevistador'))
  // return` pulava a checagem INTEIRA -- um entrevistador sem NENHUMA
  // relacao com a entrevista especifica conseguia ler/escrever scorecard
  // de qualquer entrevista do tenant, e um recrutador com papel duplo
  // ['recrutador','entrevistador'] recuperava acesso irrestrito so por ter
  // o segundo papel. A regra correta: permite se (posse por vaga) OU
  // (linha em interview_evaluator para ESTE scheduleId+userId) -- nunca um
  // "pula tudo".
  describe('checagem de posse combinada (vaga OU interview_evaluator desta entrevista especifica) -- fix da vulnerabilidade introduzida pela onda 3', () => {
    it('entrevistador cadastrado como avaliador DESTA entrevista consegue submeter mesmo sem posse da vaga', async () => {
      const submeterMock = jest.fn().mockResolvedValue({ id: 'scorecard-1' });
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga nao encontrada'));
      const queryImpl = makeQueryImpl({ evaluatorLookup: { rows: [{ found: 1 }] } });
      const { controller } = await buildController({ serviceMock: { submeter: submeterMock }, queryImpl, exigirAcessoMock });
      const req = { tenantId: 'tenant-1', userId: 'entrevistador-1', userRoles: ['entrevistador'] } as any;

      await expect(controller.submeter(req, 'schedule-1', submeterDto)).resolves.toEqual({ id: 'scorecard-1' });
      expect(submeterMock).toHaveBeenCalled();
    });

    it('entrevistador cadastrado como avaliador DESTA entrevista consegue listar mesmo sem posse da vaga', async () => {
      const listarMock = jest.fn().mockResolvedValue([]);
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga nao encontrada'));
      const queryImpl = makeQueryImpl({ evaluatorLookup: { rows: [{ found: 1 }] } });
      const { controller } = await buildController({ serviceMock: { listarPorEntrevista: listarMock }, queryImpl, exigirAcessoMock });
      const req = { tenantId: 'tenant-1', userId: 'entrevistador-1', userRoles: ['entrevistador'] } as any;

      await expect(controller.listar(req, 'schedule-1')).resolves.toEqual([]);
      expect(listarMock).toHaveBeenCalled();
    });

    it('entrevistador NAO cadastrado como avaliador desta entrevista especifica recebe 404 ao submeter (nao bypassa mais)', async () => {
      const submeterMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga nao encontrada'));
      const queryImpl = makeQueryImpl({ evaluatorLookup: { rows: [] } });
      const { controller } = await buildController({ serviceMock: { submeter: submeterMock }, queryImpl, exigirAcessoMock });
      const req = { tenantId: 'tenant-1', userId: 'entrevistador-alheio', userRoles: ['entrevistador'] } as any;

      await expect(controller.submeter(req, 'schedule-1', submeterDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(submeterMock).not.toHaveBeenCalled();
    });

    it('entrevistador NAO cadastrado como avaliador desta entrevista especifica recebe 404 ao listar (nao bypassa mais)', async () => {
      const listarMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga nao encontrada'));
      const queryImpl = makeQueryImpl({ evaluatorLookup: { rows: [] } });
      const { controller } = await buildController({ serviceMock: { listarPorEntrevista: listarMock }, queryImpl, exigirAcessoMock });
      const req = { tenantId: 'tenant-1', userId: 'entrevistador-alheio', userRoles: ['entrevistador'] } as any;

      await expect(controller.listar(req, 'schedule-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(listarMock).not.toHaveBeenCalled();
    });

    // A regressao exata reproduzida ao vivo pela revisao: papel duplo
    // ['recrutador','entrevistador'] sem posse real de nenhum dos dois
    // jeitos (nem job_recrutador, nem interview_evaluator desta entrevista)
    // continua bloqueado -- ter o segundo papel nao reabre a guarda.
    it('recrutador com papel duplo [recrutador, entrevistador] sem posse da vaga E sem ser avaliador desta entrevista continua recebendo 404', async () => {
      const submeterMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga nao encontrada'));
      const queryImpl = makeQueryImpl({ evaluatorLookup: { rows: [] } });
      const { controller, exigirAcessoMock: mockUsed } = await buildController({
        serviceMock: { submeter: submeterMock },
        queryImpl,
        exigirAcessoMock,
      });
      const req = { tenantId: 'tenant-1', userId: 'user-papel-duplo', userRoles: ['recrutador', 'entrevistador'] } as any;

      await expect(controller.submeter(req, 'schedule-1', submeterDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(submeterMock).not.toHaveBeenCalled();
      expect(mockUsed).toHaveBeenCalled();
    });

    it('recrutador com posse real da vaga continua conseguindo submeter mesmo sem ser avaliador (comportamento pre-existente preservado)', async () => {
      const submeterMock = jest.fn().mockResolvedValue({ id: 'scorecard-1' });
      const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
      const { controller } = await buildController({ serviceMock: { submeter: submeterMock }, exigirAcessoMock });
      const req = { tenantId: 'tenant-1', userId: 'recrutador-com-posse', userRoles: ['recrutador'] } as any;

      await expect(controller.submeter(req, 'schedule-1', submeterDto)).resolves.toEqual({ id: 'scorecard-1' });
      expect(submeterMock).toHaveBeenCalled();
    });
  });

  // [Achado incidental da revisao] O trigger de banco
  // trg_scorecard_avaliador_e_evaluator rejeita um INSERT/UPDATE de
  // scorecard cujo avaliador_id nao esta cadastrado como
  // interview_evaluator daquela entrevista -- cenario possivel para um
  // recrutador com posse REAL da vaga (passa pela guarda) mas que nunca
  // foi designado avaliador daquela entrevista especifica. Antes desta
  // correcao isso vazava como 500 cru; agora vira 403.
  it('submeter traduz AvaliadorNaoEhInterviewEvaluatorError (violacao do trigger de banco) para ForbiddenException (nao 500)', async () => {
    const submeterMock = jest.fn().mockRejectedValue(
      new AvaliadorNaoEhInterviewEvaluatorError('avaliador nao esta cadastrado como interview_evaluator desta entrevista'),
    );
    const { controller } = await buildController({ serviceMock: { submeter: submeterMock } });
    const req = { tenantId: 'tenant-1', userId: 'recrutador-sem-designacao', userRoles: ['recrutador'] } as any;

    await expect(controller.submeter(req, 'schedule-1', submeterDto)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('submeter ainda traduz ScorecardJaSubmetidoError para ConflictException (comportamento pre-existente preservado)', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const submeterMock = jest.fn().mockRejectedValue(new ScorecardJaSubmetidoError('ja submetido'));
    const { controller } = await buildController({ serviceMock: { submeter: submeterMock } });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    await expect(controller.submeter(req, 'schedule-1', submeterDto)).rejects.toBeInstanceOf(ConflictException);
  });

  describe('guarda de posse por recrutador (onda 3, ainda vigente)', () => {
    it('submeter lanca NotFoundException quando o interview_schedule nao existe para o tenant', async () => {
      const submeterMock = jest.fn();
      const queryImpl = makeQueryImpl({ jobLookup: { rows: [] } });
      const { controller } = await buildController({ serviceMock: { submeter: submeterMock }, queryImpl });
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.submeter(req, 'schedule-inexistente', submeterDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(submeterMock).not.toHaveBeenCalled();
    });

    it('listar lanca NotFoundException quando o interview_schedule nao existe para o tenant', async () => {
      const listarMock = jest.fn();
      const queryImpl = makeQueryImpl({ jobLookup: { rows: [] } });
      const { controller } = await buildController({ serviceMock: { listarPorEntrevista: listarMock }, queryImpl });
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.listar(req, 'schedule-inexistente')).rejects.toBeInstanceOf(NotFoundException);
      expect(listarMock).not.toHaveBeenCalled();
    });
  });
});

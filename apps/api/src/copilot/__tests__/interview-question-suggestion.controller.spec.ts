import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InterviewQuestionSuggestionController } from '../interview-question-suggestion.controller';
import { InterviewQuestionSuggestionService } from '../interview-question-suggestion.service';
import { JobRecrutadorService } from '../../hiring/job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('InterviewQuestionSuggestionController', () => {
  async function buildController(
    serviceMock: { gerar?: jest.Mock; listar?: jest.Mock } = {},
    // Guarda de posse por recrutador (onda 3 de correção pós-revisão) --
    // default: a versão do roteiro existe (com job_id) via o SELECT feito
    // por exigirPosseDoRoteiro, e o requisitante tem acesso. Os testes de
    // guarda abaixo sobrescrevem esses mocks. fakeClient.query é o mesmo
    // client usado tanto pela guarda quanto pelas rotas que passam por
    // tenantContext.run (listar) -- mesmo padrão de
    // AdherenceController.spec.ts/JobDescriptionCopilotController.spec.ts.
    queryMock: jest.Mock = jest.fn().mockResolvedValue({ rows: [{ job_id: 'job-1' }] }),
    exigirAcessoMock: jest.Mock = jest.fn().mockResolvedValue(undefined),
  ) {
    const fakeClient = { query: queryMock, release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [InterviewQuestionSuggestionController],
      providers: [
        {
          provide: InterviewQuestionSuggestionService,
          useValue: { gerar: serviceMock.gerar ?? jest.fn(), listar: serviceMock.listar ?? jest.fn() },
        },
        { provide: JobRecrutadorService, useValue: { exigirAcesso: exigirAcessoMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return moduleRef.get(InterviewQuestionSuggestionController);
  }

  it('gerar delega para service.gerar quando o recrutador tem posse', async () => {
    const suggestion = { id: 'suggestion-1', interviewGuideVersionId: 'version-1', itens: [], criadoEm: new Date() };
    const gerarMock = jest.fn().mockResolvedValue(suggestion);
    const controller = await buildController({ gerar: gerarMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.gerar(req, 'version-1');

    expect(result).toEqual(suggestion);
    expect(gerarMock).toHaveBeenCalledWith({ tenantId: 'tenant-1', interviewGuideVersionId: 'version-1', actorId: 'user-1' });
  });

  it('listar delega para service.listar quando o recrutador tem posse', async () => {
    const suggestions = [{ id: 'suggestion-1', interviewGuideVersionId: 'version-1', itens: [], criadoEm: new Date() }];
    const listarMock = jest.fn().mockResolvedValue(suggestions);
    const controller = await buildController({ listar: listarMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.listar(req, 'version-1');

    expect(result).toEqual(suggestions);
    expect(listarMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'version-1');
  });

  // Item 2 (Critical) da onda 3 de correção pós-revisão: nenhuma das 2
  // rotas deste controller tinha guarda de posse por job_recrutador -- um
  // recrutador sem atribuição podia gerar/listar sugestões de perguntas de
  // entrevista de QUALQUER vaga do tenant.
  describe('guarda de posse por recrutador (onda 3)', () => {
    it('gerar lança NotFoundException quando a versão do roteiro não existe para o tenant', async () => {
      const gerarMock = jest.fn();
      const queryMock = jest.fn().mockResolvedValue({ rows: [] });
      const controller = await buildController({ gerar: gerarMock }, queryMock);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.gerar(req, 'version-inexistente')).rejects.toBeInstanceOf(NotFoundException);
      expect(gerarMock).not.toHaveBeenCalled();
    });

    it('gerar lança NotFoundException quando o recrutador não está atribuído à vaga do roteiro', async () => {
      const gerarMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ gerar: gerarMock }, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.gerar(req, 'version-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(gerarMock).not.toHaveBeenCalled();
      expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-1',
        jobId: 'job-1',
        userId: 'recrutador-nao-atribuido',
        userRoles: ['recrutador'],
      });
    });

    it('listar lança NotFoundException quando a versão do roteiro não existe para o tenant', async () => {
      const listarMock = jest.fn();
      const queryMock = jest.fn().mockResolvedValue({ rows: [] });
      const controller = await buildController({ listar: listarMock }, queryMock);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.listar(req, 'version-inexistente')).rejects.toBeInstanceOf(NotFoundException);
      expect(listarMock).not.toHaveBeenCalled();
    });

    it('listar lança NotFoundException quando o recrutador não está atribuído à vaga do roteiro', async () => {
      const listarMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ listar: listarMock }, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.listar(req, 'version-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(listarMock).not.toHaveBeenCalled();
    });
  });
});

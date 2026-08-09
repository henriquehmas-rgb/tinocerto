import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InterviewGuideController } from '../interview-guide.controller';
import { InterviewGuideService } from '../interview-guide.service';
import { BarsGenerationService } from '../bars-generation.service';
import { JobRecrutadorService } from '../../hiring/job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('InterviewGuideController', () => {
  async function buildController(
    guideServiceMock: { criarRascunho?: jest.Mock; editarRascunho?: jest.Mock; publicar?: jest.Mock } = {},
    barsGenerationMock: { gerarRascunho?: jest.Mock } = {},
    // Guarda de posse por recrutador (onda 3 de correção pós-revisão) --
    // default: o requisitante tem acesso, e (para editar/publicar) o SELECT
    // de interview_guide.job_id encontra uma linha. Os testes de guarda
    // abaixo sobrescrevem esses mocks. Mesmo padrão de fakeClient/fakePool
    // de AdherenceController.spec.ts/InterviewQuestionSuggestionController.spec.ts.
    queryMock: jest.Mock = jest.fn().mockResolvedValue({ rows: [{ job_id: 'job-1' }] }),
    exigirAcessoMock: jest.Mock = jest.fn().mockResolvedValue(undefined),
  ) {
    const fakeClient = { query: queryMock, release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [InterviewGuideController],
      providers: [
        {
          provide: InterviewGuideService,
          useValue: {
            criarRascunho: guideServiceMock.criarRascunho ?? jest.fn(),
            editarRascunho: guideServiceMock.editarRascunho ?? jest.fn(),
            publicar: guideServiceMock.publicar ?? jest.fn(),
          },
        },
        { provide: BarsGenerationService, useValue: { gerarRascunho: barsGenerationMock.gerarRascunho ?? jest.fn() } },
        { provide: JobRecrutadorService, useValue: { exigirAcesso: exigirAcessoMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return moduleRef.get(InterviewGuideController);
  }

  it('criar delega para guideService.criarRascunho quando o recrutador tem posse da vaga', async () => {
    const criarRascunhoMock = jest.fn().mockResolvedValue({ id: 'guide-1' });
    const controller = await buildController({ criarRascunho: criarRascunhoMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.criar(req, { jobId: 'job-1', competencias: [] });

    expect(result).toEqual({ id: 'guide-1' });
    expect(criarRascunhoMock).toHaveBeenCalled();
  });

  it('gerar delega para barsGenerationService.gerarRascunho quando o recrutador tem posse da vaga', async () => {
    const gerarRascunhoMock = jest.fn().mockResolvedValue({ id: 'guide-1' });
    const controller = await buildController({}, { gerarRascunho: gerarRascunhoMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.gerar(req, { jobId: 'job-1', tituloVaga: 'Dev', textoRequisicao: 'x' });

    expect(result).toEqual({ id: 'guide-1' });
    expect(gerarRascunhoMock).toHaveBeenCalled();
  });

  it('editar delega para guideService.editarRascunho quando o recrutador tem posse da vaga do guia', async () => {
    const editarRascunhoMock = jest.fn().mockResolvedValue(undefined);
    const controller = await buildController({ editarRascunho: editarRascunhoMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.editar(req, 'guide-1', { competencias: [] });

    expect(result).toEqual({ id: 'guide-1' });
    expect(editarRascunhoMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'guide-1', []);
  });

  it('publicar delega para guideService.publicar quando o recrutador tem posse da vaga do guia', async () => {
    const publicarMock = jest.fn().mockResolvedValue({ id: 'version-1', versao: 1 });
    const controller = await buildController({ publicar: publicarMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.publicar(req, 'guide-1');

    expect(result).toEqual({ id: 'version-1', versao: 1 });
    expect(publicarMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'guide-1', 'user-1');
  });

  // Item 3 da onda 3 de correção pós-revisão: nenhuma das 4 rotas deste
  // controller (criar, editar, publicar, gerar) tinha guarda de posse por
  // job_recrutador -- este módulo é mais antigo que o conceito de
  // job_recrutador (Fase 3a) e nunca passou pela rodada de correção que os
  // outros controllers já receberam.
  describe('guarda de posse por recrutador (onda 3)', () => {
    it('criar lança NotFoundException quando o recrutador não está atribuído à vaga', async () => {
      const criarRascunhoMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ criarRascunho: criarRascunhoMock }, {}, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.criar(req, { jobId: 'job-1', competencias: [] })).rejects.toBeInstanceOf(NotFoundException);
      expect(criarRascunhoMock).not.toHaveBeenCalled();
      expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-1',
        jobId: 'job-1',
        userId: 'recrutador-nao-atribuido',
        userRoles: ['recrutador'],
      });
    });

    it('gerar lança NotFoundException quando o recrutador não está atribuído à vaga', async () => {
      const gerarRascunhoMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({}, { gerarRascunho: gerarRascunhoMock }, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(
        controller.gerar(req, { jobId: 'job-1', tituloVaga: 'Dev', textoRequisicao: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(gerarRascunhoMock).not.toHaveBeenCalled();
    });

    it('editar lança NotFoundException quando o interview_guide não existe para o tenant', async () => {
      const editarRascunhoMock = jest.fn();
      const queryMock = jest.fn().mockResolvedValue({ rows: [] });
      const controller = await buildController({ editarRascunho: editarRascunhoMock }, {}, queryMock);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.editar(req, 'guide-inexistente', { competencias: [] })).rejects.toBeInstanceOf(NotFoundException);
      expect(editarRascunhoMock).not.toHaveBeenCalled();
    });

    it('editar lança NotFoundException quando o recrutador não está atribuído à vaga do guia', async () => {
      const editarRascunhoMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ editarRascunho: editarRascunhoMock }, {}, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.editar(req, 'guide-1', { competencias: [] })).rejects.toBeInstanceOf(NotFoundException);
      expect(editarRascunhoMock).not.toHaveBeenCalled();
      expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-1',
        jobId: 'job-1',
        userId: 'recrutador-nao-atribuido',
        userRoles: ['recrutador'],
      });
    });

    it('publicar lança NotFoundException quando o interview_guide não existe para o tenant', async () => {
      const publicarMock = jest.fn();
      const queryMock = jest.fn().mockResolvedValue({ rows: [] });
      const controller = await buildController({ publicar: publicarMock }, {}, queryMock);
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.publicar(req, 'guide-inexistente')).rejects.toBeInstanceOf(NotFoundException);
      expect(publicarMock).not.toHaveBeenCalled();
    });

    it('publicar lança NotFoundException quando o recrutador não está atribuído à vaga do guia', async () => {
      const publicarMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ publicar: publicarMock }, {}, undefined, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.publicar(req, 'guide-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(publicarMock).not.toHaveBeenCalled();
    });
  });
});

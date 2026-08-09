import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { JobDescriptionCopilotController } from '../job-description-copilot.controller';
import { JobDescriptionCopilotService } from '../job-description-copilot.service';
import { JobRecrutadorService } from '../../hiring/job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('JobDescriptionCopilotController', () => {
  async function buildController(
    serviceMock: { sugerir?: jest.Mock; listar?: jest.Mock; aplicar?: jest.Mock } = {},
    // Guarda de posse por recrutador (onda 2 de correção pós-revisão) --
    // default: resolve (não bloqueia). Os testes de guarda abaixo passam
    // seu próprio mock rejeitado.
    exigirAcessoMock: jest.Mock = jest.fn().mockResolvedValue(undefined),
  ) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [JobDescriptionCopilotController],
      providers: [
        {
          provide: JobDescriptionCopilotService,
          useValue: {
            sugerir: serviceMock.sugerir ?? jest.fn(),
            listar: serviceMock.listar ?? jest.fn(),
            aplicar: serviceMock.aplicar ?? jest.fn(),
          },
        },
        { provide: JobRecrutadorService, useValue: { exigirAcesso: exigirAcessoMock } },
        { provide: DatabaseService, useValue: { pool: fakePool } },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return moduleRef.get(JobDescriptionCopilotController);
  }

  it('POST / delega para service.sugerir quando o recrutador tem posse', async () => {
    const suggestion = { id: 'suggestion-1', jobId: 'job-1', textoOriginal: 'a', textoSugerido: 'b', criadoEm: new Date() };
    const sugerirMock = jest.fn().mockResolvedValue(suggestion);
    const controller = await buildController({ sugerir: sugerirMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.gerar(req, 'job-1');

    expect(result).toEqual(suggestion);
    expect(sugerirMock).toHaveBeenCalledWith({ tenantId: 'tenant-1', jobId: 'job-1', actorId: 'user-1' });
  });

  it('GET / delega para service.listar quando o recrutador tem posse', async () => {
    const suggestions = [{ id: 'suggestion-1', jobId: 'job-1', textoOriginal: 'a', textoSugerido: 'b', criadoEm: new Date() }];
    const listarMock = jest.fn().mockResolvedValue(suggestions);
    const controller = await buildController({ listar: listarMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.listar(req, 'job-1');

    expect(result).toEqual(suggestions);
    expect(listarMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'job-1');
  });

  it('POST :suggestionId/apply delega para service.aplicar quando o recrutador tem posse', async () => {
    const aplicado = { jobId: 'job-1', descricao: 'b', suggestionId: 'suggestion-1', aplicadoEm: new Date() };
    const aplicarMock = jest.fn().mockResolvedValue(aplicado);
    const controller = await buildController({ aplicar: aplicarMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.aplicar(req, 'job-1', 'suggestion-1');

    expect(result).toEqual(aplicado);
    expect(aplicarMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      jobId: 'job-1',
      suggestionId: 'suggestion-1',
      actorId: 'user-1',
    });
  });

  // Achado Critical da revisão de segurança da onda 2: nenhuma das 3 rotas
  // deste controller tinha guarda de posse por job_recrutador -- um
  // recrutador sem atribuição podia gerar/listar/aplicar sugestões de
  // reescrita de descrição de QUALQUER vaga do tenant.
  describe('guarda de posse por recrutador (onda 2)', () => {
    it('POST / lança NotFoundException quando o recrutador não está atribuído à vaga', async () => {
      const sugerirMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ sugerir: sugerirMock }, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.gerar(req, 'job-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(sugerirMock).not.toHaveBeenCalled();
      expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-1',
        jobId: 'job-1',
        userId: 'recrutador-nao-atribuido',
        userRoles: ['recrutador'],
      });
    });

    it('GET / lança NotFoundException quando o recrutador não está atribuído à vaga', async () => {
      const listarMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ listar: listarMock }, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.listar(req, 'job-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(listarMock).not.toHaveBeenCalled();
    });

    it('POST :suggestionId/apply lança NotFoundException quando o recrutador não está atribuído à vaga', async () => {
      const aplicarMock = jest.fn();
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const controller = await buildController({ aplicar: aplicarMock }, exigirAcessoMock);
      const req = { tenantId: 'tenant-1', userId: 'recrutador-nao-atribuido', userRoles: ['recrutador'] } as any;

      await expect(controller.aplicar(req, 'job-1', 'suggestion-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(aplicarMock).not.toHaveBeenCalled();
    });
  });
});

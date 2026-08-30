import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { JobController, AtribuirRecrutadoresDto, CreateJobDto } from '../job.controller';
import { JobService } from '../job.service';
import { JobRecrutadorService, RecrutadorInvalidoError } from '../job-recrutador.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';
import { AdherenceService } from '../../matching/adherence.service';

describe('JobController', () => {
  async function buildController(
    jobServiceMock: Partial<Record<keyof JobService, jest.Mock>>,
    jobRecrutadorServiceMock: Partial<Record<keyof JobRecrutadorService, jest.Mock>> = {},
    adherenceServiceMock: Partial<Record<keyof AdherenceService, jest.Mock>> = {},
  ) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [JobController],
      providers: [
        { provide: JobService, useValue: jobServiceMock },
        { provide: JobRecrutadorService, useValue: jobRecrutadorServiceMock },
        { provide: DatabaseService, useValue: { pool: fakePool } },
        { provide: AdherenceService, useValue: adherenceServiceMock },
      ],
    })
      .overrideGuard(CerbosGuard)
      .useValue({ canActivate: () => true })
      .compile();
    return moduleRef.get(JobController);
  }

  describe('funil', () => {
    it('acrescenta scoreAderencia em cada candidatura', async () => {
      const funilMock = jest.fn().mockResolvedValue({
        funil: {
          triagem: [
            { id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana', criadoEm: new Date(), assessmentStatus: null, origemCanal: null },
          ],
        },
        conversao: { triagem: null },
      });
      const controller = await buildController(
        { funil: funilMock },
        { exigirAcesso: jest.fn().mockResolvedValue(undefined) },
        { porCandidaturasDaVaga: jest.fn().mockResolvedValue(new Map([['app-1', 72]])) },
      );
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      const resposta = await controller.funil(req, 'vaga-1');

      expect(resposta.funil.triagem[0].scoreAderencia).toBe(72);
      expect(resposta.conversao).toEqual({ triagem: null });
    });

    it('renderiza o funil mesmo quando o cálculo de aderência falha', async () => {
      // O funil é a tela de trabalho do recrutador. Ela não pode cair
      // porque o subsistema de matching quebrou -- fit é best-effort.
      const funilMock = jest.fn().mockResolvedValue({
        funil: {
          triagem: [
            { id: 'app-1', personId: 'p-1', nomeCandidato: 'Ana', criadoEm: new Date(), assessmentStatus: null, origemCanal: null },
          ],
        },
        conversao: { triagem: null },
      });
      const controller = await buildController(
        { funil: funilMock },
        { exigirAcesso: jest.fn().mockResolvedValue(undefined) },
        { porCandidaturasDaVaga: jest.fn().mockRejectedValue(new Error('person_profile indisponível')) },
      );
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      const resposta = await controller.funil(req, 'vaga-1');

      expect(resposta.funil.triagem[0].scoreAderencia).toBeNull();
      expect(resposta.funil.triagem[0].nomeCandidato).toBe('Ana');
    });
  });

  it('GET / delega para jobService.listar com tenantId/userId/userRoles da requisição', async () => {
    const listarMock = jest
      .fn()
      .mockResolvedValue([{ id: 'job-1', titulo: 'Vaga X', publicadoEm: null, criadoEm: new Date() }]);
    const controller = await buildController({ listar: listarMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.list(req);

    expect(listarMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      userId: 'user-1',
      userRoles: ['recrutador'],
    });
    expect(result).toHaveLength(1);
  });

  it('GET dashboard-metrics delega para jobService.obterMetricas com tenantId/userId/userRoles da requisição', async () => {
    const obterMetricasMock = jest.fn().mockResolvedValue({
      vagasAtivas: 2,
      vagasRascunho: 1,
      candidaturasEmAndamento: 3,
      porEstagio: { triagem: 3 },
    });
    const controller = await buildController({ obterMetricas: obterMetricasMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

    const result = await controller.dashboardMetrics(req);

    expect(obterMetricasMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      userId: 'user-1',
      userRoles: ['recrutador'],
    });
    expect(result.vagasAtivas).toBe(2);
  });

  it('POST :id/actions/atribuir-recrutadores delega para jobRecrutadorService.exigirAcesso e atribuir', async () => {
    const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
    const atribuirMock = jest.fn().mockResolvedValue(undefined);
    const controller = await buildController({}, { exigirAcesso: exigirAcessoMock, atribuir: atribuirMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['admin_tenant'] } as any;

    const result = await controller.atribuirRecrutadores(req, 'job-1', { recrutadorIds: ['r1', 'r2'] });

    expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      userId: 'user-1',
      userRoles: ['admin_tenant'],
    });
    expect(atribuirMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      recrutadorIds: ['r1', 'r2'],
    });
    expect(result).toEqual({ id: 'job-1', recrutadorIds: ['r1', 'r2'] });
  });

  it('PATCH :id delega para jobRecrutadorService.exigirAcesso e jobService.editar', async () => {
    const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
    const editarMock = jest.fn().mockResolvedValue(undefined);
    const controller = await buildController({ editar: editarMock }, { exigirAcesso: exigirAcessoMock });
    const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['gestor_vaga'] } as any;

    const result = await controller.editar(req, 'job-1', {
      titulo: 'Novo Título',
      descricao: 'Nova descrição',
      habilidadesExigidas: ['SQL'],
    });

    expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      userId: 'user-1',
      userRoles: ['gestor_vaga'],
    });
    expect(editarMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      titulo: 'Novo Título',
      descricao: 'Nova descrição',
      habilidadesExigidas: ['SQL'],
    });
    expect(result).toEqual({ id: 'job-1' });
  });

  // Achado C1 da revisão de coerência do Painel do Recrutador: a UI de
  // criar vaga (apps/web/app/staff/painel/vagas/nova/page.tsx) não envia
  // recrutadorIds -- sem esta garantia no controller, quem cria a vaga
  // fica trancado fora dela (nenhum recrutador atribuído, nem o próprio
  // criador).
  describe('POST / -- criador sempre entra em recrutadorIds (Fase 5a, fix C1)', () => {
    it('inclui req.userId em recrutadorIds mesmo quando o DTO não envia nenhum', async () => {
      const createMock = jest.fn().mockResolvedValue({ id: 'job-novo' });
      const controller = await buildController({ create: createMock });
      const req = { tenantId: 'tenant-1', userId: 'user-criador', userRoles: ['recrutador'] } as any;

      await controller.create(req, { requisitionId: 'req-1', titulo: 'Vaga Nova' } as any);

      expect(createMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-1',
        requisitionId: 'req-1',
        titulo: 'Vaga Nova',
        habilidadesExigidas: undefined,
        recrutadorIds: ['user-criador'],
      });
    });

    it('deduplica req.userId quando o DTO já envia outros recrutadorIds (inclusive o próprio userId repetido)', async () => {
      const createMock = jest.fn().mockResolvedValue({ id: 'job-novo' });
      const controller = await buildController({ create: createMock });
      const req = { tenantId: 'tenant-1', userId: 'user-criador', userRoles: ['admin_tenant'] } as any;

      await controller.create(req, {
        requisitionId: 'req-1',
        titulo: 'Vaga Nova',
        recrutadorIds: ['user-criador', 'outro-recrutador'],
      } as any);

      expect(createMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recrutadorIds: ['user-criador', 'outro-recrutador'] }),
      );
    });
  });

  // Achado C2 da revisão de coerência: Cerbos libera "recrutador" para
  // publish/declararHabilidadesExigidas (mesma regra "gestao-vaga" de
  // create/read/update), mas a guarda de posse por job_recrutador nunca
  // tinha sido aplicada nessas duas rotas.
  describe('guarda de posse por recrutador em publish/declararHabilidadesExigidas (Fase 5a, fix C2)', () => {
    it('POST :id/actions/publish lança NotFoundException quando o recrutador não está atribuído à vaga', async () => {
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const publishMock = jest.fn();
      const controller = await buildController({ publish: publishMock }, { exigirAcesso: exigirAcessoMock });
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.publish(req, 'job-1', { canais: ['site_carreiras'] })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(publishMock).not.toHaveBeenCalled();
    });

    it('POST :id/actions/publish delega para jobService.publish quando o recrutador tem posse', async () => {
      const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
      const publishMock = jest.fn().mockResolvedValue(undefined);
      const controller = await buildController({ publish: publishMock }, { exigirAcesso: exigirAcessoMock });
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      const result = await controller.publish(req, 'job-1', { canais: ['site_carreiras'] });

      expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-1',
        jobId: 'job-1',
        userId: 'user-1',
        userRoles: ['recrutador'],
      });
      expect(publishMock).toHaveBeenCalledWith(expect.anything(), 'job-1', ['site_carreiras']);
      expect(result).toEqual({ id: 'job-1', status: 'publicada' });
    });

    it('POST :id/actions/declarar-habilidades-exigidas lança NotFoundException quando o recrutador não está atribuído à vaga', async () => {
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const declararMock = jest.fn();
      const controller = await buildController(
        { declararHabilidadesExigidas: declararMock },
        { exigirAcesso: exigirAcessoMock },
      );
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(
        controller.declararHabilidadesExigidas(req, 'job-1', { habilidades: ['React'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(declararMock).not.toHaveBeenCalled();
    });
  });

  // C4 pré-requisito: GET /v1/jobs/:id, usada pelo frontend para
  // pré-preencher o formulário de edição.
  describe('GET :id (Fase 5a, fix C4 pré-requisito)', () => {
    it('retorna os dados da vaga com recrutadorIds quando o recrutador tem acesso', async () => {
      const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
      const findByIdMock = jest.fn().mockResolvedValue({
        id: 'job-1',
        titulo: 'Vaga X',
        descricao: 'Descrição',
        habilidadesExigidas: ['SQL'],
        publicadoEm: null,
        criadoEm: new Date(),
      });
      const listarPorVagaMock = jest.fn().mockResolvedValue(['user-1']);
      const controller = await buildController(
        { findById: findByIdMock },
        { exigirAcesso: exigirAcessoMock, listarPorVaga: listarPorVagaMock },
      );
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      const result = await controller.findOne(req, 'job-1');

      expect(exigirAcessoMock).toHaveBeenCalledWith(expect.anything(), {
        tenantId: 'tenant-1',
        jobId: 'job-1',
        userId: 'user-1',
        userRoles: ['recrutador'],
      });
      expect(findByIdMock).toHaveBeenCalledWith(expect.anything(), { tenantId: 'tenant-1', jobId: 'job-1' });
      expect(result).toEqual(
        expect.objectContaining({ id: 'job-1', titulo: 'Vaga X', recrutadorIds: ['user-1'] }),
      );
    });

    it('lança NotFoundException quando o recrutador não está atribuído à vaga (posse)', async () => {
      const exigirAcessoMock = jest.fn().mockRejectedValue(new NotFoundException('Vaga não encontrada'));
      const findByIdMock = jest.fn();
      const controller = await buildController({ findById: findByIdMock }, { exigirAcesso: exigirAcessoMock });
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'] } as any;

      await expect(controller.findOne(req, 'job-inexistente')).rejects.toBeInstanceOf(NotFoundException);
      expect(findByIdMock).not.toHaveBeenCalled();
    });

    it('lança NotFoundException quando a vaga não existe (mesmo com posse concedida)', async () => {
      const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
      const findByIdMock = jest.fn().mockResolvedValue(null);
      const controller = await buildController({ findById: findByIdMock }, { exigirAcesso: exigirAcessoMock });
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['admin_tenant'] } as any;

      await expect(controller.findOne(req, 'job-inexistente')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // Achado I4 da revisão de coerência: recrutadorIds aceitava qualquer
  // string -- um id malformado passava direto para o INSERT em
  // job_recrutador e estourava 500 (22P02) em vez de 400.
  describe('AtribuirRecrutadoresDto -- validação de UUID (Fase 5a, fix I4)', () => {
    it('rejeita quando recrutadorIds contém um id que não é UUID', async () => {
      const dto = plainToInstance(AtribuirRecrutadoresDto, { recrutadorIds: ['nao-e-um-uuid'] });
      const erros = await validate(dto);
      expect(erros).not.toHaveLength(0);
      expect(erros[0].constraints).toHaveProperty('isUuid');
    });

    it('aceita quando todos os recrutadorIds são UUIDs válidos', async () => {
      const dto = plainToInstance(AtribuirRecrutadoresDto, {
        recrutadorIds: ['c56a4180-65aa-42ec-a945-5fd21dec0538'],
      });
      const erros = await validate(dto);
      expect(erros).toHaveLength(0);
    });
  });

  // Item 3a da onda 2 de correção pós-revisão: o mesmo achado I4 (id
  // não-UUID em recrutadorIds estourava 500 via 22P02) só tinha sido
  // corrigido em AtribuirRecrutadoresDto -- CreateJobDto.recrutadorIds
  // continuava aceitando qualquer string.
  describe('CreateJobDto -- validação de UUID (onda 2, fix 3a)', () => {
    it('rejeita quando recrutadorIds contém um id que não é UUID', async () => {
      const dto = plainToInstance(CreateJobDto, {
        requisitionId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
        titulo: 'Vaga X',
        recrutadorIds: ['nao-e-um-uuid'],
      });
      const erros = await validate(dto);
      const erroRecrutadorIds = erros.find((e) => e.property === 'recrutadorIds');
      expect(erroRecrutadorIds?.constraints).toHaveProperty('isUuid');
    });

    it('aceita quando recrutadorIds não é enviado (opcional) ou contém apenas UUIDs válidos', async () => {
      const semRecrutadorIds = plainToInstance(CreateJobDto, {
        requisitionId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
        titulo: 'Vaga X',
      });
      expect(await validate(semRecrutadorIds)).toHaveLength(0);

      const comUuidValido = plainToInstance(CreateJobDto, {
        requisitionId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
        titulo: 'Vaga X',
        recrutadorIds: ['c56a4180-65aa-42ec-a945-5fd21dec0538'],
      });
      expect(await validate(comUuidValido)).toHaveLength(0);
    });
  });

  // Item 3b da onda 2 de correção pós-revisão: um UUID bem-formado mas de
  // um user_account inexistente/de outro tenant estourava a FK composta
  // fk_job_recrutador_tenant_staff como 500 -- tanto em POST /v1/jobs
  // (create, via JobService.create -> JobRecrutadorService.atribuir) quanto
  // em POST :id/actions/atribuir-recrutadores. JobRecrutadorService.atribuir
  // agora traduz essa violação num RecrutadorInvalidoError; os testes
  // abaixo travam que os dois pontos de entrada do controller traduzem
  // esse erro de negócio para 400 (não deixam vazar como 500).
  describe('RecrutadorInvalidoError traduzida para 400 (onda 2, fix 3b)', () => {
    it('POST / traduz RecrutadorInvalidoError (de JobService.create) em BadRequestException', async () => {
      const createMock = jest.fn().mockRejectedValue(new RecrutadorInvalidoError('recrutador inválido'));
      const controller = await buildController({ create: createMock });
      const req = { tenantId: 'tenant-1', userId: 'user-criador', userRoles: ['admin_tenant'] } as any;

      await expect(
        controller.create(req, { requisitionId: 'req-1', titulo: 'Vaga Nova' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('POST :id/actions/atribuir-recrutadores traduz RecrutadorInvalidoError em BadRequestException', async () => {
      const exigirAcessoMock = jest.fn().mockResolvedValue(undefined);
      const atribuirMock = jest.fn().mockRejectedValue(new RecrutadorInvalidoError('recrutador inválido'));
      const controller = await buildController({}, { exigirAcesso: exigirAcessoMock, atribuir: atribuirMock });
      const req = { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['admin_tenant'] } as any;

      await expect(
        controller.atribuirRecrutadores(req, 'job-1', {
          recrutadorIds: ['c56a4180-65aa-42ec-a945-5fd21dec0538'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

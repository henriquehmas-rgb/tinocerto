import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApplicationController } from '../application.controller';
import { ApplicationService } from '../application.service';
import { PipelineStageTransitionService } from '../pipeline-stage-transition.service';
import { DecisionService } from '../decision.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('ApplicationController', () => {
  async function buildController(moveStageMock: jest.Mock, recordMock: jest.Mock = jest.fn()) {
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
});

import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ApplicationController } from '../application.controller';
import { ApplicationService } from '../application.service';
import { PipelineStageTransitionService } from '../pipeline-stage-transition.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';

describe('ApplicationController', () => {
  async function buildController(moveStageMock: jest.Mock) {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };
    const moduleRef = await Test.createTestingModule({
      controllers: [ApplicationController],
      providers: [
        { provide: ApplicationService, useValue: { findByIdWithPersonView: jest.fn() } },
        { provide: PipelineStageTransitionService, useValue: { moveStage: moveStageMock } },
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
});

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CerbosGuard } from '../cerbos.guard';
import { CerbosService } from '../cerbos.service';
import { CERBOS_CHECK_KEY } from '../cerbos-check.decorator';

function buildContext(req: Record<string, unknown>, metadata: { resourceKind: string; action: string } | undefined) {
  const reflector = {
    get: jest.fn().mockReturnValue(metadata),
  } as unknown as Reflector;
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('CerbosGuard', () => {
  it('permite quando CerbosService.check retorna true para a ação', async () => {
    const cerbosService = { check: jest.fn().mockResolvedValue({ create: true }) } as unknown as CerbosService;
    const { context, reflector } = buildContext(
      { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'], params: {} },
      { resourceKind: 'requisition', action: 'create' },
    );
    const guard = new CerbosGuard(cerbosService, reflector);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(cerbosService.check).toHaveBeenCalledWith(
      { id: 'user-1', roles: ['recrutador'], attr: { tenant_id: 'tenant-1' } },
      { kind: 'requisition', id: 'new', attr: { tenant_id: 'tenant-1' } },
      ['create'],
    );
  });

  it('lança ForbiddenException quando CerbosService.check retorna false', async () => {
    const cerbosService = { check: jest.fn().mockResolvedValue({ create: false }) } as unknown as CerbosService;
    const { context, reflector } = buildContext(
      { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['candidato'], params: {} },
      { resourceKind: 'requisition', action: 'create' },
    );
    const guard = new CerbosGuard(cerbosService, reflector);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('usa params.id como id do recurso quando presente (ex.: PATCH /jobs/:id)', async () => {
    const cerbosService = { check: jest.fn().mockResolvedValue({ update: true }) } as unknown as CerbosService;
    const { context, reflector } = buildContext(
      { tenantId: 'tenant-1', userId: 'user-1', userRoles: ['recrutador'], params: { id: 'job-existing-42' } },
      { resourceKind: 'job', action: 'update' },
    );
    const guard = new CerbosGuard(cerbosService, reflector);

    await guard.canActivate(context);
    expect(cerbosService.check).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'job', id: 'job-existing-42', attr: { tenant_id: 'tenant-1' } },
      ['update'],
    );
  });

  it('permite passar quando não há metadata @CerbosCheck no handler (rota sem checagem, ex. health-check)', async () => {
    const cerbosService = { check: jest.fn() } as unknown as CerbosService;
    const { context, reflector } = buildContext({}, undefined);
    const guard = new CerbosGuard(cerbosService, reflector);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(cerbosService.check).not.toHaveBeenCalled();
  });
});

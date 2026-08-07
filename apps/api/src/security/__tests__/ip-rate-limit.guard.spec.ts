// apps/api/src/security/__tests__/ip-rate-limit.guard.spec.ts
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IpRateLimitGuard } from '../ip-rate-limit.guard';
import { IpRateLimitService } from '../ip-rate-limit.service';
import { IP_RATE_LIMIT_KEY } from '../ip-rate-limit.decorator';

function buildContext(ip: string): { context: ExecutionContext; res: { headers: Record<string, string> } } {
  const res = {
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  const context = {
    getHandler: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
  return { context, res };
}

describe('IpRateLimitGuard', () => {
  it('deixa passar sem checar nada quando a rota não tem @IpRateLimit(...)', async () => {
    const rateLimitService = { checkAndIncrement: jest.fn() } as unknown as IpRateLimitService;
    const reflector = { get: () => undefined } as unknown as Reflector;
    const guard = new IpRateLimitGuard(rateLimitService, reflector);

    const { context } = buildContext('198.51.100.1');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rateLimitService.checkAndIncrement).not.toHaveBeenCalled();
  });

  it('lança 429 com Retry-After quando o limite é excedido', async () => {
    const rateLimitService = {
      checkAndIncrement: jest.fn().mockResolvedValue({ allowed: false, remaining: 0, resetSeconds: 42 }),
    } as unknown as IpRateLimitService;
    const reflector = {
      get: (key: string) => (key === IP_RATE_LIMIT_KEY ? { escopo: 'login', limit: 10, windowSeconds: 60 } : undefined),
    } as unknown as Reflector;
    const guard = new IpRateLimitGuard(rateLimitService, reflector);

    const { context, res } = buildContext('198.51.100.2');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 429 });
    expect(res.headers['Retry-After']).toBe('42');
  });

  it('permite e seta headers quando dentro do limite', async () => {
    const rateLimitService = {
      checkAndIncrement: jest.fn().mockResolvedValue({ allowed: true, remaining: 7, resetSeconds: 30 }),
    } as unknown as IpRateLimitService;
    const reflector = {
      get: (key: string) => (key === IP_RATE_LIMIT_KEY ? { escopo: 'login', limit: 10, windowSeconds: 60 } : undefined),
    } as unknown as Reflector;
    const guard = new IpRateLimitGuard(rateLimitService, reflector);

    const { context, res } = buildContext('198.51.100.3');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(res.headers['X-RateLimit-Remaining']).toBe('7');
  });
});

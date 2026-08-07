import { ExecutionContext } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DatabaseService } from '../../database/database.service';
import { RateLimitService } from '../rate-limit.service';
import { RateLimitGuard } from '../rate-limit.guard';
import { PlatformApiProblem } from '../platform-api-problem';

function fakeContext(req: Record<string, unknown>) {
  const headers: Record<string, string> = {};
  const res = { setHeader: jest.fn((nome: string, valor: string) => { headers[nome] = valor; }) };
  const context = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { context, res, headers };
}

describe('RateLimitGuard', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const databaseService = { pool: appPool } as DatabaseService;
  const rateLimitService = new RateLimitService(databaseService);
  const guard = new RateLimitGuard(rateLimitService);
  // RateLimitService abre seu próprio cliente ioredis internamente (mesmo
  // padrão de GoogleCalendarConnectionController/OutboxPublisher) -- sem
  // fechar explicitamente no afterAll, a conexão TCP fica aberta e o
  // processo Jest deste arquivo não encerra sozinho.
  const redisInterno = (rateLimitService as unknown as { redis: Redis }).redis;

  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('RateLimitGuard Ltda','00000000000153','test-tenant-00000000000153') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
    await redisInterno.quit();
  });

  it('requisição permitida -- popula headers RateLimit-* e X-RateLimit-* e devolve true', async () => {
    const { context, headers } = fakeContext({ apiKeyId: randomUUID(), tenantId });
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(headers['RateLimit-Policy']).toBe('"default";q=60;w=60');
    expect(headers['RateLimit']).toMatch(/^"default";r=59;t=\d+$/);
    expect(headers['X-RateLimit-Limit']).toBe('60');
    expect(headers['X-RateLimit-Remaining']).toBe('59');
    expect(typeof headers['X-RateLimit-Reset']).toBe('string');
    expect(headers['Retry-After']).toBeUndefined();
  });

  it('limite excedido -- lança PlatformApiProblem 429 com rate_limit_reason tenant-rate e Retry-After', async () => {
    const apiKeyId = randomUUID();
    for (let i = 0; i < 60; i++) {
      const { context } = fakeContext({ apiKeyId, tenantId });
      await guard.canActivate(context);
    }

    const { context, headers } = fakeContext({ apiKeyId, tenantId });
    try {
      await guard.canActivate(context);
      throw new Error('deveria ter lançado PlatformApiProblem 429');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformApiProblem);
      const problem = err as PlatformApiProblem;
      expect(problem.getStatus()).toBe(429);
      expect(problem.getProblemBody().extensions.rate_limit_reason).toBe('tenant-rate');
    }
    expect(headers['X-RateLimit-Remaining']).toBe('0');
    expect(typeof headers['Retry-After']).toBe('string');
  });
});

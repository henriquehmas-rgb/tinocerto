import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, firstValueFrom } from 'rxjs';
import { Pool } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { IdempotencyService } from '../idempotency.service';
import { IdempotencyInterceptor } from '../idempotency.interceptor';
import { PlatformApiProblem } from '../platform-api-problem';

function fakeContext(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('IdempotencyInterceptor', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const databaseService = { pool: appPool } as DatabaseService;

  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Idempotency Interceptor Ltda','00000000000144','test-tenant-00000000000144') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM idempotency_key WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('primeira chamada executa o handler; repetição com o mesmo corpo devolve o snapshot sem re-executar', async () => {
    const interceptor = new IdempotencyInterceptor(new IdempotencyService(), databaseService);
    let execucoes = 0;
    const handler: CallHandler = { handle: () => { execucoes++; return of({ ok: true, execucao: execucoes }); } };
    const req = { tenantId, body: { valor: 42 }, header: (n: string) => (n.toLowerCase() === 'idempotency-key' ? 'chave-teste-1' : undefined) };

    const primeira = await firstValueFrom(interceptor.intercept(fakeContext(req), handler));
    expect(primeira).toEqual({ ok: true, execucao: 1 });

    const segunda = await firstValueFrom(interceptor.intercept(fakeContext(req), handler));
    expect(segunda).toEqual({ ok: true, execucao: 1 });
    expect(execucoes).toBe(1);
  });

  it('mesma chave com corpo diferente lança PlatformApiProblem (422 idempotency-key-conflict)', async () => {
    const interceptor = new IdempotencyInterceptor(new IdempotencyService(), databaseService);
    const handler: CallHandler = { handle: () => of({ ok: true }) };
    const reqA = { tenantId, body: { valor: 1 }, header: () => 'chave-teste-2' };
    const reqB = { tenantId, body: { valor: 2 }, header: () => 'chave-teste-2' };

    await firstValueFrom(interceptor.intercept(fakeContext(reqA), handler));
    await expect(firstValueFrom(interceptor.intercept(fakeContext(reqB), handler))).rejects.toBeInstanceOf(PlatformApiProblem);
  });

  it('sem header Idempotency-Key, passa direto e executa toda vez', async () => {
    const interceptor = new IdempotencyInterceptor(new IdempotencyService(), databaseService);
    let execucoes = 0;
    const handler: CallHandler = { handle: () => { execucoes++; return of({ ok: true }); } };
    const req = { tenantId, body: {}, header: () => undefined };

    await firstValueFrom(interceptor.intercept(fakeContext(req), handler));
    await firstValueFrom(interceptor.intercept(fakeContext(req), handler));
    expect(execucoes).toBe(2);
  });
});

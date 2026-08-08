import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { TenantContext } from '../tenant-context';
import { TenantResolutionMiddleware } from '../tenant-transaction.middleware';
import { StaffJwtService } from '../../staff-auth/staff-jwt.service';
import { mintStaffJwt } from '../../staff-auth/__tests__/mint-staff-jwt';

describe('TenantContext.run', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const pool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Ctx', '00000000000006', 'test-tenant-00000000000006') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await pool.end();
  });

  it('executa a função dentro de uma transação com SET LOCAL já aplicado', async () => {
    const ctx = new TenantContext(pool);

    const result = await ctx.run(tenantId, async (client) => {
      await client.query(`INSERT INTO user_account (tenant_id, email) VALUES ($1, 'ctx@teste.com')`, [
        tenantId,
      ]);
      const rows = await client.query('SELECT * FROM user_account');
      return rows.rows;
    });

    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('ctx@teste.com');

    // Prova de commit real: reconsulta via conexão INDEPENDENTE (adminPool,
    // fora da transação de `ctx.run()`) -- se COMMIT não tivesse rodado, esta
    // linha não existiria aqui, mesmo que a asserção acima (dentro da mesma
    // transação) tivesse passado de qualquer forma.
    const persisted = await adminPool.query(
      `SELECT email FROM user_account WHERE tenant_id = $1 AND email = 'ctx@teste.com'`,
      [tenantId],
    );
    expect(persisted.rows).toHaveLength(1);
  });

  it('faz ROLLBACK se a função lançar', async () => {
    const ctx = new TenantContext(pool);

    await expect(
      ctx.run(tenantId, async (client) => {
        await client.query(`INSERT INTO user_account (tenant_id, email) VALUES ($1, 'rollback@teste.com')`, [
          tenantId,
        ]);
        throw new Error('erro proposital');
      }),
    ).rejects.toThrow('erro proposital');

    const rows = await adminPool.query(
      `SELECT * FROM user_account WHERE email = 'rollback@teste.com'`,
    );
    expect(rows.rows).toHaveLength(0);
  });
});

// TDD (Task 8) -- TenantResolutionMiddleware trocou headers de confiança
// (x-tenant-id/x-user-id/x-user-roles, sem verificação de assinatura) por
// JWT verificado via StaffJwtService. Estes testes rodam a classe do
// middleware diretamente (sem subir a aplicação Nest inteira, sem tocar o
// banco) -- rápido o suficiente para viver ao lado dos testes de
// TenantContext acima, que precisam de Postgres real.
describe('TenantResolutionMiddleware', () => {
  function buildRequest(headers: Record<string, string>): Request & { tenantId?: string; userId?: string; userRoles?: string[] } {
    return {
      header: (name: string) => headers[name.toLowerCase()],
    } as unknown as Request & { tenantId?: string; userId?: string; userRoles?: string[] };
  }

  it('popula req.tenantId/req.userId/req.userRoles a partir de um JWT válido no header Authorization: Bearer, sem depender dos headers antigos', () => {
    const middleware = new TenantResolutionMiddleware(new StaffJwtService());
    const token = mintStaffJwt({ userId: 'user-1', tenantId: 'tenant-1', roles: ['admin_tenant'] });
    const req = buildRequest({ authorization: `Bearer ${token}` });
    const next = jest.fn();

    middleware.use(req, {} as Response, next);

    expect(req.tenantId).toBe('tenant-1');
    expect(req.userId).toBe('user-1');
    expect(req.userRoles).toEqual(['admin_tenant']);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('lança 401 quando o JWT tem assinatura inválida (assinado com segredo diferente do configurado)', () => {
    const middleware = new TenantResolutionMiddleware(new StaffJwtService());
    const tokenComSegredoErrado = jwt.sign(
      { userId: 'user-1', tenantId: 'tenant-1', roles: ['admin_tenant'] },
      'segredo-errado-nao-e-o-configurado',
      { expiresIn: '1h' },
    );
    const req = buildRequest({ authorization: `Bearer ${tokenComSegredoErrado}` });
    const next = jest.fn();

    expect(() => middleware.use(req, {} as Response, next)).toThrow();
    expect(next).not.toHaveBeenCalled();
  });

  it('lança 401 quando não há header Authorization: Bearer', () => {
    const middleware = new TenantResolutionMiddleware(new StaffJwtService());
    const req = buildRequest({});
    const next = jest.fn();

    expect(() => middleware.use(req, {} as Response, next)).toThrow('Bearer token ausente');
    expect(next).not.toHaveBeenCalled();
  });
});

import { NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PublicTenantResolutionMiddleware } from '../public-tenant-resolution.middleware';

describe('PublicTenantResolutionMiddleware', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let tenantSlug: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string; slug: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Public MW', '00000000000040', 'empresa-public-mw-test') RETURNING id, slug`,
    );
    tenantId = t.rows[0].id;
    tenantSlug = t.rows[0].slug;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
  });

  it('resolve req.tenantId a partir de params.tenantSlug contra o banco', async () => {
    const middleware = new PublicTenantResolutionMiddleware(adminPool);
    const req: any = { params: { tenantSlug } };
    const next = jest.fn();

    await middleware.use(req, {} as any, next);

    expect(req.tenantId).toBe(tenantId);
    expect(next).toHaveBeenCalled();
  });

  it('lança NotFoundException para slug inexistente (nunca revela se o tenant existe mas está inativo)', async () => {
    const middleware = new PublicTenantResolutionMiddleware(adminPool);
    const req: any = { params: { tenantSlug: 'slug-que-nao-existe' } };
    const next = jest.fn();

    await expect(middleware.use(req, {} as any, next)).rejects.toThrow(NotFoundException);
    expect(next).not.toHaveBeenCalled();
  });
});

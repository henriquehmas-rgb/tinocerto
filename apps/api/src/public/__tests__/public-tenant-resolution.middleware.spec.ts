import { NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PublicTenantResolutionMiddleware } from '../public-tenant-resolution.middleware';

describe('PublicTenantResolutionMiddleware', () => {
  // adminPool (DATABASE_URL, role dono do schema, superuser nesta fase de
  // dev) só serve pra setup/teardown -- provisionar/apagar tenant é
  // operação administrativa que app_runtime nunca tem permissão de fazer
  // (GRANT SELECT/UPDATE limitado em identity_0002__tenant.sql).
  //
  // appPool (app_runtime, NOBYPASSRLS) é o que efetivamente constrói o
  // middleware sob teste -- é essa a role que o provider de
  // public.module.ts injeta em produção
  // (`{ provide: Pool, useFactory: (db) => db.pool, inject: [DatabaseService] }`,
  // e DatabaseService só conecta como app_runtime). Instanciar o
  // middleware com adminPool aqui bypassaria RLS por completo e deixaria
  // este teste estruturalmente incapaz de detectar uma regressão na
  // resolução de tenant sob RLS -- foi exatamente esse o bug encontrado
  // na revisão adversarial do fix round 1 da Task 7.
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
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
    await appPool.end();
  });

  it('resolve req.tenantId a partir de params.tenantSlug contra o banco, mesmo sob RLS (role app_runtime, sem app.tenant_id setado)', async () => {
    const middleware = new PublicTenantResolutionMiddleware(appPool);
    const req: any = { params: { tenantSlug } };
    const next = jest.fn();

    await middleware.use(req, {} as any, next);

    expect(req.tenantId).toBe(tenantId);
    expect(next).toHaveBeenCalled();
  });

  it('lança NotFoundException para slug inexistente (nunca revela se o tenant existe mas está inativo)', async () => {
    const middleware = new PublicTenantResolutionMiddleware(appPool);
    const req: any = { params: { tenantSlug: 'slug-que-nao-existe' } };
    const next = jest.fn();

    await expect(middleware.use(req, {} as any, next)).rejects.toThrow(NotFoundException);
    expect(next).not.toHaveBeenCalled();
  });

  it('lança NotFoundException para tenant existente porém inativo (mesma resposta que slug inexistente)', async () => {
    const inactive = await adminPool.query<{ id: string; slug: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug, status) VALUES ('Empresa Public MW Inativa', '00000000000041', 'empresa-public-mw-inativa-test', 'inativo') RETURNING id, slug`,
    );
    const inactiveTenantId = inactive.rows[0].id;
    const inactiveSlug = inactive.rows[0].slug;

    try {
      const middleware = new PublicTenantResolutionMiddleware(appPool);
      const req: any = { params: { tenantSlug: inactiveSlug } };
      const next = jest.fn();

      await expect(middleware.use(req, {} as any, next)).rejects.toThrow(NotFoundException);
      expect(next).not.toHaveBeenCalled();
    } finally {
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [inactiveTenantId]);
    }
  });
});

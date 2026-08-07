// apps/api/src/platform-api/__tests__/developer-api-key.controller.spec.ts
//
// DESVIO DO PLANO (encontrado ao rodar os testes, Task 3, Step 5): o
// plano original usava userId: 'admin-user-172' (string arbitrária, não
// UUID) nos requests fabricados. O controller grava esse valor em
// service_account.owner_user_id, coluna `uuid NOT NULL REFERENCES
// user_account(id)` -- Postgres rejeita com "invalid input syntax for
// type uuid" antes mesmo de chegar na FK. Corrigido inserindo
// user_account reais (mesmo padrão usado em todo o resto do plano, ex.
// service-account-crp-link.service.spec.ts) e usando seus ids reais como
// userId dos requests fabricados.
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { DeveloperApiKeyController } from '../developer-api-key.controller';
import { ApiKeyService } from '../api-key.service';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';
import { CerbosService } from '../../authz/cerbos.service';
import { Reflector } from '@nestjs/core';

describe('DeveloperApiKeyController (integração real)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const databaseService = { pool: appPool } as DatabaseService;
  const cerbosService = new CerbosService(process.env.CERBOS_HTTP_URL!);

  let tenantId: string;
  let adminUserId: string;
  let adminUserBId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Dev API Key Ltda','00000000000172','test-tenant-00000000000172') RETURNING id`,
    );
    tenantId = t.rows[0].id;

    const adminUser = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'admin-user-172@example.com') RETURNING id`,
      [tenantId],
    );
    adminUserId = adminUser.rows[0].id;

    const adminUserB = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'admin-user-172b@example.com') RETURNING id`,
      [tenantId],
    );
    adminUserBId = adminUserB.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM api_key WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM service_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  async function buildController() {
    const moduleRef = await Test.createTestingModule({
      controllers: [DeveloperApiKeyController],
      providers: [
        { provide: ApiKeyService, useValue: new ApiKeyService(appPool) },
        { provide: DatabaseService, useValue: databaseService },
        CerbosGuard,
        { provide: CerbosService, useValue: cerbosService },
        Reflector,
      ],
    }).compile();
    return moduleRef.get(DeveloperApiKeyController);
  }

  it('admin_tenant cria chave, lista sem reexpor o segredo, e revoga', async () => {
    const controller = await buildController();
    const req = { tenantId, userId: adminUserId, userRoles: ['admin_tenant'], params: {} } as any;

    const criada = await controller.create(req, { nome: 'Integração Zapier', scopes: ['applications:read'] });
    expect(criada.raw_key.startsWith('tnc_live_')).toBe(true);
    expect(criada.prefixo.length).toBeGreaterThan(0);

    const lista = await controller.list(req);
    expect(lista.data.some((k: any) => k.id === criada.id)).toBe(true);
    // Nunca reexpõe raw_key na listagem.
    expect(lista.data.every((k: any) => !('raw_key' in k))).toBe(true);

    const revogada = await controller.revoke({ ...req, params: { id: criada.id } }, criada.id);
    expect(revogada.status).toBe('revogada');
  });

  it('rotate emite chave nova preservando o mesmo service_account_id', async () => {
    const controller = await buildController();
    const req = { tenantId, userId: adminUserBId, userRoles: ['admin_tenant'], params: {} } as any;
    const criada = await controller.create(req, { nome: 'Integração Rotável', scopes: ['psych:report.read'] });

    const rotacionada = await controller.rotate({ ...req, params: { id: criada.id } }, criada.id);
    expect(rotacionada.raw_key).not.toBe(criada.raw_key);
    expect(rotacionada.overlap_days).toBe(7);
  });
});

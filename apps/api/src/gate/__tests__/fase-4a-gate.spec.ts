import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import * as YAML from 'yaml';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { TenantContext } from '../../database/tenant-context';
import { ApiKeyService } from '../../platform-api/api-key.service';
import { ApiKeyGuard } from '../../platform-api/api-key.guard';
import { CerbosService } from '../../authz/cerbos.service';

const OPENAPI_ROOT = path.resolve(__dirname, '../../../openapi');

function fakeContext(headers: Record<string, string | undefined>) {
  const req: Record<string, unknown> = { header: (name: string) => headers[name.toLowerCase()] };
  const context = { switchToHttp: () => ({ getRequest: () => req }) } as any;
  return { context, req };
}

describe('Gate consolidado — Fase 4a (OpenAPI + Plataforma API)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const apiKeyService = new ApiKeyService(appPool);
  const apiKeyGuard = new ApiKeyGuard(apiKeyService);
  const cerbosService = new CerbosService(process.env.CERBOS_HTTP_URL!);

  afterAll(async () => {
    await adminPool.end();
    await appPool.end();
  });

  it.each(['api_key', 'idempotency_key'])('%s tem RLS FORCE+RESTRICTIVE com predicado NULLIF', async (tabela) => {
    const rel = await adminPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
      [tabela],
    );
    expect(rel.rows[0].relrowsecurity).toBe(true);
    expect(rel.rows[0].relforcerowsecurity).toBe(true);

    const pol = await adminPool.query<{ policyname: string; permissive: string; qual: string }>(
      `SELECT policyname, permissive, qual FROM pg_policies WHERE tablename = $1`,
      [tabela],
    );
    const restritiva = pol.rows.find((r) => r.policyname === 'tenant_isolation');
    expect(restritiva?.permissive).toBe('RESTRICTIVE');
    expect(restritiva?.qual).toContain('NULLIF');
  });

  it('as migrations da Fase 4a estão registradas no manifest, na ordem certa', () => {
    const manifest = JSON.parse(readFileSync(path.join(__dirname, '../../../migrations/manifest.json'), 'utf-8')) as {
      migrations: string[];
    };
    for (const migration of [
      'platform_0003__api_key.sql',
      'platform_0004__idempotency_key.sql',
      'hiring_0018__application_tenant_criado_id_index.sql',
    ]) {
      expect(manifest.migrations).toContain(migration);
    }
  });

  it('todo arquivo do documento OpenAPI faz parse válido', () => {
    function listYamlFiles(dir: string, acc: string[] = []): string[] {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entrada.name);
        if (entrada.isDirectory()) listYamlFiles(full, acc);
        else if (entrada.name.endsWith('.yaml')) acc.push(full);
      }
      return acc;
    }
    for (const file of listYamlFiles(OPENAPI_ROOT)) {
      expect(() => YAML.parse(readFileSync(file, 'utf-8'))).not.toThrow();
    }
  });

  it('ponta a ponta: um integrador externo cria uma chave, autentica com Authorization: Bearer, lista candidaturas por cursor, recebe 403 RFC 9457 ao usar uma chave sem o escopo certo, e vê isolamento de tenant real', async () => {
    let tenantId: string | undefined;
    let outroTenantId: string | undefined;
    try {
      // --- setup de domínio: tenant, org_unit, requisição aprovada, vaga, 3 candidaturas ---
      tenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 4a Ltda','00000000000149','test-tenant-00000000000149') RETURNING id`,
        )
      ).rows[0].id;
      outroTenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 4a Outro Ltda','00000000000150','test-tenant-00000000000150') RETURNING id`,
        )
      ).rows[0].id;

      const orgUnit = await adminPool.query<{ id: string }>(
        `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
        [tenantId],
      );
      const requisition = await adminPool.query<{ id: string }>(
        `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Gate 4a', 'aprovada', now()) RETURNING id`,
        [tenantId, orgUnit.rows[0].id],
      );
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Gate 4a', 'vaga-gate-4a') RETURNING id`,
        [tenantId, requisition.rows[0].id],
      );

      const applicationIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const person = await adminPool.query<{ id: string }>(
          `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
           VALUES ($1, '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', $2, $3) RETURNING id`,
          [`hash-gate-4a-${i}`, `Candidato Gate 4a ${i}`, `gate4a-${i}@example.com`],
        );
        const app = await adminPool.query<{ id: string }>(
          `INSERT INTO application (tenant_id, job_id, person_id, criado_em) VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantId, job.rows[0].id, person.rows[0].id, new Date(Date.UTC(2026, 7, 1, 10, 0, i))],
        );
        applicationIds.push(app.rows[0].id);
      }

      // --- integrador externo: cria service_account + emite uma chave com escopo applications:read ---
      const owner = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'owner-gate-4a@example.com') RETURNING id`,
        [tenantId],
      );
      const serviceAccount = await adminPool.query<{ id: string }>(
        `INSERT INTO service_account (tenant_id, nome, owner_user_id) VALUES ($1, 'Integração Gate 4a', $2) RETURNING id`,
        [tenantId, owner.rows[0].id],
      );
      const issued = await tenantContext.run(tenantId, (client) =>
        apiKeyService.issue(client, { tenantId: tenantId!, serviceAccountId: serviceAccount.rows[0].id, escopos: ['applications:read'] }),
      );

      // Chave de escopo INSUFICIENTE (mesmo tenant, sem applications:read) -- prova o 403 RFC 9457.
      const issuedSemEscopo = await tenantContext.run(tenantId, (client) =>
        apiKeyService.issue(client, { tenantId: tenantId!, serviceAccountId: serviceAccount.rows[0].id, escopos: ['requisitions:read'] }),
      );

      // --- 1. ApiKeyGuard autentica de verdade com a chave emitida ---
      const { context: contextOk, req: reqOk } = fakeContext({ authorization: `Bearer ${issued.rawKey}` });
      await expect(apiKeyGuard.canActivate(contextOk)).resolves.toBe(true);
      expect(reqOk.tenantId).toBe(tenantId);
      expect(reqOk.apiKeyScopes).toEqual(['applications:read']);

      // --- 2. Cerbos real: escopo certo permite, escopo errado nega (403 RFC 9457 correto) ---
      const decisaoOk = await cerbosService.check(
        { id: serviceAccount.rows[0].id, roles: ['service_account'], attr: { tenant_id: tenantId, scopes: ['applications:read'] } },
        { kind: 'application', id: 'new', attr: { tenant_id: tenantId } },
        ['read'],
      );
      expect(decisaoOk.read).toBe(true);

      const decisaoNegada = await cerbosService.check(
        { id: serviceAccount.rows[0].id, roles: ['service_account'], attr: { tenant_id: tenantId, scopes: ['requisitions:read'] } },
        { kind: 'application', id: 'new', attr: { tenant_id: tenantId } },
        ['read'],
      );
      expect(decisaoNegada.read).toBe(false);

      // --- 3. Aplicação real de ponta a ponta: boot do Nest, GET /v1/applications via fetch nativo ---
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app: INestApplication = moduleRef.createNestApplication();
      // main.ts aplica ValidationPipe global em bootstrap() (fora de
      // AppModule) -- Test.createTestingModule só reconstrói o grafo de
      // módulos, não os efeitos colaterais de bootstrap(). Sem isto,
      // ?limit=2 chegaria como STRING em ListApplicationsQuery.limit (o
      // @Type(()=>Number) do DTO só roda dentro do ValidationPipe), quebrando
      // a query de LIMIT no Postgres. Mesma configuração exata de main.ts.
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.init();
      await app.listen(0);
      const serverUrl = await app.getUrl();

      try {
        const respostaPagina1 = await fetch(`${serverUrl}/v1/applications?limit=2`, {
          headers: { authorization: `Bearer ${issued.rawKey}` },
        });
        expect(respostaPagina1.status).toBe(200);
        const corpoPagina1 = (await respostaPagina1.json()) as { data: Array<{ id: string }>; has_more: boolean; next_cursor: string | null };
        expect(corpoPagina1.data).toHaveLength(2);
        expect(corpoPagina1.data.map((a) => a.id)).toEqual([applicationIds[0], applicationIds[1]]);
        expect(corpoPagina1.has_more).toBe(true);
        expect(corpoPagina1.next_cursor).not.toBeNull();

        const respostaPagina2 = await fetch(`${serverUrl}/v1/applications?limit=2&cursor=${encodeURIComponent(corpoPagina1.next_cursor!)}`, {
          headers: { authorization: `Bearer ${issued.rawKey}` },
        });
        const corpoPagina2 = (await respostaPagina2.json()) as { data: Array<{ id: string }>; has_more: boolean };
        expect(corpoPagina2.data.map((a) => a.id)).toEqual([applicationIds[2]]);
        expect(corpoPagina2.has_more).toBe(false);

        // 403 RFC 9457 com a chave de escopo insuficiente.
        const respostaSemEscopo = await fetch(`${serverUrl}/v1/applications`, {
          headers: { authorization: `Bearer ${issuedSemEscopo.rawKey}` },
        });
        expect(respostaSemEscopo.status).toBe(403);
        const corpoSemEscopo = (await respostaSemEscopo.json()) as { type: string; status: number; trace_id: string };
        expect(corpoSemEscopo.type).toBe('https://developers.tinocerto.com.br/problems/erro-http');
        expect(corpoSemEscopo.status).toBe(403);
        expect(typeof corpoSemEscopo.trace_id).toBe('string');

        // 401 RFC 9457 sem Authorization.
        const respostaSemAuth = await fetch(`${serverUrl}/v1/applications`);
        expect(respostaSemAuth.status).toBe(401);
        const corpoSemAuth = (await respostaSemAuth.json()) as { type: string };
        expect(corpoSemAuth.type).toBe('https://developers.tinocerto.com.br/problems/credenciais-invalidas');

        // Isolamento: chave de OUTRO tenant nunca vê estas candidaturas.
        const outroOwner = await adminPool.query<{ id: string }>(
          `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'owner-outro-gate-4a@example.com') RETURNING id`,
          [outroTenantId],
        );
        const outroServiceAccount = await adminPool.query<{ id: string }>(
          `INSERT INTO service_account (tenant_id, nome, owner_user_id) VALUES ($1, 'Integração Outro Gate 4a', $2) RETURNING id`,
          [outroTenantId, outroOwner.rows[0].id],
        );
        const issuedOutro = await tenantContext.run(outroTenantId, (client) =>
          apiKeyService.issue(client, { tenantId: outroTenantId!, serviceAccountId: outroServiceAccount.rows[0].id, escopos: ['applications:read'] }),
        );
        const respostaOutroTenant = await fetch(`${serverUrl}/v1/applications`, {
          headers: { authorization: `Bearer ${issuedOutro.rawKey}` },
        });
        const corpoOutroTenant = (await respostaOutroTenant.json()) as { data: unknown[] };
        expect(corpoOutroTenant.data).toEqual([]);
      } finally {
        await app.close();
      }
    } finally {
      if (tenantId) {
        await adminPool.query('DELETE FROM api_key WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM service_account WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
        await adminPool.query(`DELETE FROM person WHERE cpf_hash LIKE 'hash-gate-4a-%'`);
        await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
      }
      if (outroTenantId) {
        await adminPool.query('DELETE FROM api_key WHERE tenant_id = $1', [outroTenantId]);
        await adminPool.query('DELETE FROM service_account WHERE tenant_id = $1', [outroTenantId]);
        await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [outroTenantId]);
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenantId]);
      }
    }
  }, 60000);
});

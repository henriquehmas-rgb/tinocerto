import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { TenantContext } from '../../database/tenant-context';
import { ApiKeyService } from '../../platform-api/api-key.service';

describe('Gate consolidado — Fase 4b (Rate Limiting)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const apiKeyService = new ApiKeyService(appPool);

  afterAll(async () => {
    await adminPool.end();
    await appPool.end();
  });

  it(
    'ponta a ponta: um integrador no plano entrada estoura o limite de 60 req/min e recebe 429 com rate_limit_reason correto; headers presentes e decrescentes em toda resposta; bucket de outro tenant/chave permanece intacto',
    async () => {
      let tenantId: string | undefined;
      let outroTenantId: string | undefined;
      try {
        tenantId = (
          await adminPool.query<{ id: string }>(
            `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 4b Ltda','00000000000155','test-tenant-00000000000155') RETURNING id`,
          )
        ).rows[0].id;
        outroTenantId = (
          await adminPool.query<{ id: string }>(
            `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 4b Outro Ltda','00000000000156','test-tenant-00000000000156') RETURNING id`,
          )
        ).rows[0].id;

        const owner = await adminPool.query<{ id: string }>(
          `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'owner-gate-4b@example.com') RETURNING id`,
          [tenantId],
        );
        const serviceAccount = await adminPool.query<{ id: string }>(
          `INSERT INTO service_account (tenant_id, nome, owner_user_id) VALUES ($1, 'Integração Gate 4b', $2) RETURNING id`,
          [tenantId, owner.rows[0].id],
        );
        const issued = await tenantContext.run(tenantId, (client) =>
          apiKeyService.issue(client, { tenantId: tenantId!, serviceAccountId: serviceAccount.rows[0].id, escopos: ['applications:read'] }),
        );

        const outroOwner = await adminPool.query<{ id: string }>(
          `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'owner-outro-gate-4b@example.com') RETURNING id`,
          [outroTenantId],
        );
        const outroServiceAccount = await adminPool.query<{ id: string }>(
          `INSERT INTO service_account (tenant_id, nome, owner_user_id) VALUES ($1, 'Integração Outro Gate 4b', $2) RETURNING id`,
          [outroTenantId, outroOwner.rows[0].id],
        );
        const issuedOutro = await tenantContext.run(outroTenantId, (client) =>
          apiKeyService.issue(client, { tenantId: outroTenantId!, serviceAccountId: outroServiceAccount.rows[0].id, escopos: ['applications:read'] }),
        );

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
        const app: INestApplication = moduleRef.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        await app.listen(0);
        const serverUrl = await app.getUrl();

        try {
          // --- 60 requisições reais, todas 200, headers decrescendo 59 -> 0 ---
          // A asserção `remaining === 59 - i` já prova o decréscimo estrito de 1
          // em 1 a cada resposta (não é só "não decresce", é decréscimo exato).
          let ultimaRemaining = -1;
          for (let i = 0; i < 60; i++) {
            const resposta = await fetch(`${serverUrl}/v1/applications`, {
              headers: { authorization: `Bearer ${issued.rawKey}` },
            });
            expect(resposta.status).toBe(200);

            const limite = Number(resposta.headers.get('x-ratelimit-limit'));
            const remaining = Number(resposta.headers.get('x-ratelimit-remaining'));
            const policy = resposta.headers.get('ratelimit-policy');
            const rateLimitHeader = resposta.headers.get('ratelimit');

            expect(limite).toBe(60);
            expect(remaining).toBe(59 - i);
            expect(policy).toBe('"default";q=60;w=60');
            expect(rateLimitHeader).toMatch(new RegExp(`^"default";r=${59 - i};t=\\d+$`));
            ultimaRemaining = remaining;
          }
          expect(ultimaRemaining).toBe(0);

          // --- 61ª requisição: 429 RFC 9457, rate_limit_reason correto, Retry-After presente ---
          const resposta429 = await fetch(`${serverUrl}/v1/applications`, {
            headers: { authorization: `Bearer ${issued.rawKey}` },
          });
          expect(resposta429.status).toBe(429);
          expect(typeof resposta429.headers.get('retry-after')).toBe('string');
          expect(resposta429.headers.get('x-ratelimit-remaining')).toBe('0');

          const corpo429 = (await resposta429.json()) as {
            type: string;
            status: number;
            rate_limit_reason: string;
            trace_id: string;
          };
          expect(corpo429.type).toBe('https://developers.tinocerto.com.br/problems/limite-de-taxa-excedido');
          expect(corpo429.status).toBe(429);
          expect(corpo429.rate_limit_reason).toBe('tenant-rate');
          expect(typeof corpo429.trace_id).toBe('string');

          // --- Isolamento: bucket do OUTRO tenant/chave não foi afetado pelo consumo acima ---
          const respostaOutro = await fetch(`${serverUrl}/v1/applications`, {
            headers: { authorization: `Bearer ${issuedOutro.rawKey}` },
          });
          expect(respostaOutro.status).toBe(200);
          expect(respostaOutro.headers.get('x-ratelimit-remaining')).toBe('59');
        } finally {
          await app.close();
        }
      } finally {
        if (tenantId) {
          await adminPool.query('DELETE FROM api_key WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM service_account WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
          await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
        }
        if (outroTenantId) {
          await adminPool.query('DELETE FROM api_key WHERE tenant_id = $1', [outroTenantId]);
          await adminPool.query('DELETE FROM service_account WHERE tenant_id = $1', [outroTenantId]);
          await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [outroTenantId]);
          await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenantId]);
        }
      }
    },
    60000,
  );
});

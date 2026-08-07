// apps/api/src/platform-api/webhooks/__tests__/webhook-endpoint.controller.spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Pool } from 'pg';
import { AppModule } from '../../../app.module';

describe('WebhookEndpointController', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let app: INestApplication;
  let serverUrl: string;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Webhook Endpoint Controller Ltda','00000000000154','test-tenant-00000000000154') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const role = await adminPool.query<{ id: string }>(`SELECT id FROM role WHERE nome = 'admin_tenant' AND tenant_id IS NULL`);
    const u = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'admin-webhook-154@example.com') RETURNING id`,
      [tenantId],
    );
    userId = u.rows[0].id;
    await adminPool.query(`INSERT INTO role_assignment (user_id, tenant_id, role_id, scope_path) VALUES ($1, $2, $3, 'matriz')`, [
      userId,
      tenantId,
      role.rows[0].id,
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.listen(0);
    serverUrl = await app.getUrl();
  });

  // Desvio adicional do plano (documentado): a ordem original do plano
  // (app.close() primeiro, DELETE de fixture depois) deixa as linhas de
  // fixture (tenant/user_account/role_assignment) órfãs no banco sempre que
  // app.close() ultrapassa o timeout padrão de hook do Jest (5000ms) --
  // que É o caso aqui, mesmo quirk de ambiente já documentado no briefing
  // (três consumers de outbox pré-existentes que não desligam limpo:
  // ResumeParsingConsumer/AdverseImpactConsumer/CandidateApplicationSummaryConsumer,
  // confirmado reproduzível até em route-topology.spec.ts da própria Fase
  // 4a já mesclada, rodado isoladamente). Órfãos de fixture então colidem
  // (unique constraint em tenant.cnpj) em reexecuções futuras da suíte.
  // Corrigido: DELETE primeiro (rápido, sempre completa), app.close() por
  // último com timeout de hook aumentado -- se app.close() estourar mesmo
  // assim, ao menos o banco já está limpo.
  afterAll(async () => {
    await adminPool.query('DELETE FROM role_assignment WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM webhook_endpoint WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await app.close();
  }, 60_000);

  it('POST /v1/webhook-endpoints com url http:// (não https) é rejeitado com 400', async () => {
    const resposta = await fetch(`${serverUrl}/v1/webhook-endpoints`, {
      method: 'POST',
      // Desvio do plano original (deviation documentado): a versão literal
      // deste teste no plano de execução (2026-08-07-fase-4c-webhooks.md,
      // Task 4 Step 5) omitia o header x-user-roles. TenantResolutionMiddleware
      // (src/database/tenant-transaction.middleware.ts) exige x-tenant-id
      // E x-user-id E x-user-roles -- sem o terceiro, toda requisição desta
      // suite falharia com 401 'x-user-roles ausente' antes mesmo de chegar
      // ao CerbosGuard, tornando as asserções de 400/201 abaixo inalcançáveis.
      // Confirmado contra route-topology.spec.ts (Fase 4a) e
      // tenant-transaction.middleware.ts, que exigem os três headers.
      // Corrigido aqui adicionando x-user-roles: 'admin_tenant' (o papel
      // atribuído ao usuário de fixture acima).
      headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId, 'x-user-roles': 'admin_tenant' },
      body: JSON.stringify({ url: 'http://inseguro.com.br', eventosFiltro: [] }),
    });
    expect(resposta.status).toBe(400);
  });

  it('POST /v1/webhook-endpoints com url https:// válida cria o endpoint e devolve o segredo em claro', async () => {
    const resposta = await fetch(`${serverUrl}/v1/webhook-endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-user-id': userId, 'x-user-roles': 'admin_tenant' },
      body: JSON.stringify({ url: 'https://exemplo.com.br/webhooks', eventosFiltro: ['application.created'] }),
    });
    expect(resposta.status).toBe(201);
    const corpo = (await resposta.json()) as { segredoAtual: string };
    expect(corpo.segredoAtual.startsWith('whsec_')).toBe(true);
  });
});

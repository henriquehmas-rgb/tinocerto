import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';

// Verificação dedicada, ADICIONAL ao que o plano de execução da Fase 4a
// pede explicitamente (o gate da Task 7 prova só o lado novo -- GET
// /v1/applications com API key -- via fetch real; não prova que a rota de
// SESSÃO existente, GET /v1/applications/:id, continua exigindo
// x-tenant-id/x-user-id depois da exclusão exata adicionada em
// TenantResolutionMiddleware.exclude()). Pedido explícito de escrutínio
// extra para esta mudança específica (app.module.ts, Task 4 Step 3):
// route-topology é o tipo de mudança onde um erro tanto vaza um endpoint
// interno sem autenticação quanto quebra um endpoint de sessão existente
// -- os dois lados precisam de prova via boot real do Nest + HTTP real,
// não só leitura de código-fonte.
describe('Topologia de rotas -- exclusão exata de GET v1/applications em TenantResolutionMiddleware', () => {
  let app: INestApplication;
  let serverUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Mesma configuração de main.ts -- ver nota equivalente no gate da
    // Task 7: Test.createTestingModule reconstrói só o grafo de módulos,
    // não os efeitos colaterais de bootstrap() (app.useGlobalPipes fica de
    // fora por padrão).
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.listen(0);
    serverUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/applications/:id (rota de sessão existente, ApplicationController) continua exigindo x-tenant-id/x-user-id -- 401 do TenantResolutionMiddleware, NÃO excluído', async () => {
    const resposta = await fetch(`${serverUrl}/v1/applications/11111111-1111-1111-1111-111111111111`);
    expect(resposta.status).toBe(401);
    const corpo = (await resposta.json()) as { message?: string; statusCode?: number };
    // Forma do UnauthorizedException PADRÃO do Nest (TenantResolutionMiddleware),
    // NUNCA a forma RFC 9457 do PlatformApiExceptionFilter -- prova que esta
    // requisição passou PELO middleware (não foi excluída) e falhou lá, antes
    // de qualquer guard da Plataforma API rodar.
    expect(corpo.statusCode).toBe(401);
    expect(corpo.message).toBe('x-tenant-id ausente');
  });

  it('GET /v1/applications (rota nova, PlatformApplicationController) NÃO passa por TenantResolutionMiddleware -- sem Authorization, falha no ApiKeyGuard (RFC 9457), nunca no middleware de sessão', async () => {
    const resposta = await fetch(`${serverUrl}/v1/applications`);
    expect(resposta.status).toBe(401);
    const corpo = (await resposta.json()) as { type?: string; message?: string; statusCode?: number };
    // Forma RFC 9457 do PlatformApiExceptionFilter (ApiKeyGuard) -- NUNCA a
    // forma {statusCode, message} do UnauthorizedException do
    // TenantResolutionMiddleware. Se a exclusão do app.module.ts tivesse
    // regredido para prefixo/wildcard errado (ou tivesse sido removida), esta
    // requisição teria sido barrada pelo middleware ANTES de chegar ao
    // ApiKeyGuard, e o corpo seria {statusCode: 401, message: 'x-tenant-id
    // ausente'} em vez do formato abaixo.
    expect(corpo.type).toBe('https://developers.tinocerto.com.br/problems/credenciais-invalidas');
    expect(corpo.statusCode).toBeUndefined();
  });

  it('GET /v1/applications mesmo COM x-tenant-id/x-user-id (headers de sessão) ainda exige Authorization: Bearer -- prova que esses headers de sessão não substituem a autenticação por API key nesta rota', async () => {
    const resposta = await fetch(`${serverUrl}/v1/applications`, {
      headers: { 'x-tenant-id': '11111111-1111-1111-1111-111111111111', 'x-user-id': '22222222-2222-2222-2222-222222222222', 'x-user-roles': 'recrutador' },
    });
    expect(resposta.status).toBe(401);
    const corpo = (await resposta.json()) as { type?: string };
    expect(corpo.type).toBe('https://developers.tinocerto.com.br/problems/credenciais-invalidas');
  });

  it('GET /v1/applications/:id continua exigindo x-tenant-id MESMO enviando um Authorization: Bearer (a rota de sessão não aceita API key)', async () => {
    const resposta = await fetch(`${serverUrl}/v1/applications/11111111-1111-1111-1111-111111111111`, {
      headers: { authorization: 'Bearer tnc_live_qualquercoisaXXXXXXXXXXXXXXXXXXXXXX' },
    });
    expect(resposta.status).toBe(401);
    const corpo = (await resposta.json()) as { message?: string };
    expect(corpo.message).toBe('x-tenant-id ausente');
  });
});

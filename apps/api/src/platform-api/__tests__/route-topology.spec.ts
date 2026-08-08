import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { mintStaffJwt } from '../../staff-auth/__tests__/mint-staff-jwt';

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

  // DESVIO (achado ao rodar a suíte completa via Task 8, não introduzido por
  // ela): app.close() estoura o timeout padrão de hook do Jest (5000ms)
  // quando esta suite roda depois de muitas outras no mesmo processo --
  // mesmo quirk de ambiente já documentado em
  // webhook-endpoint.controller.spec.ts (consumers de outbox pré-existentes
  // que não desligam limpo: ResumeParsingConsumer/AdverseImpactConsumer/
  // CandidateApplicationSummaryConsumer). Mesmo fix aplicado lá: timeout de
  // hook aumentado.
  afterAll(async () => {
    await app.close();
  }, 60_000);

  it('GET /v1/applications/:id (rota de sessão existente, ApplicationController) continua exigindo Authorization: Bearer -- 401 do TenantResolutionMiddleware, NÃO excluído', async () => {
    const resposta = await fetch(`${serverUrl}/v1/applications/11111111-1111-1111-1111-111111111111`);
    expect(resposta.status).toBe(401);
    const corpo = (await resposta.json()) as { message?: string; statusCode?: number };
    // Forma do UnauthorizedException PADRÃO do Nest (TenantResolutionMiddleware),
    // NUNCA a forma RFC 9457 do PlatformApiExceptionFilter -- prova que esta
    // requisição passou PELO middleware (não foi excluída) e falhou lá, antes
    // de qualquer guard da Plataforma API rodar.
    //
    // Task 8: TenantResolutionMiddleware trocou headers de confiança por JWT
    // verificado -- mensagem mudou de 'x-tenant-id ausente' para 'Bearer
    // token ausente' (nenhum Authorization: Bearer nesta requisição).
    expect(corpo.statusCode).toBe(401);
    expect(corpo.message).toBe('Bearer token ausente');
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

  it('GET /v1/applications mesmo com um JWT de sessão de staff válido (Authorization: Bearer) não é aceito -- prova que a identidade de sessão não substitui a autenticação por API key nesta rota', async () => {
    // Task 8: antes da migração, isso testava os headers de confiança antigos
    // (x-tenant-id/x-user-id/x-user-roles). Depois da migração, a identidade
    // de sessão de staff É um Authorization: Bearer <JWT> -- o mesmo slot de
    // header que ApiKeyGuard espera uma chave tnc_live_*. Este teste prova
    // que ApiKeyGuard rejeita um JWT de staff válido (formato errado para
    // API key), não confunde os dois mecanismos.
    const resposta = await fetch(`${serverUrl}/v1/applications`, {
      headers: {
        authorization: `Bearer ${mintStaffJwt({ userId: '22222222-2222-2222-2222-222222222222', tenantId: '11111111-1111-1111-1111-111111111111', roles: ['recrutador'] })}`,
      },
    });
    expect(resposta.status).toBe(401);
    const corpo = (await resposta.json()) as { type?: string };
    expect(corpo.type).toBe('https://developers.tinocerto.com.br/problems/credenciais-invalidas');
  });

  it('GET /v1/applications/:id rejeita um Authorization: Bearer no formato de API key (não é um JWT válido) -- a rota de sessão não aceita API key', async () => {
    const resposta = await fetch(`${serverUrl}/v1/applications/11111111-1111-1111-1111-111111111111`, {
      headers: { authorization: 'Bearer tnc_live_qualquercoisaXXXXXXXXXXXXXXXXXXXXXX' },
    });
    expect(resposta.status).toBe(401);
    const corpo = (await resposta.json()) as { message?: string };
    // Task 8: TenantResolutionMiddleware agora tenta verificar o token como
    // JWT de staff -- uma chave de API (formato tnc_live_*) não é um JWT
    // válido, então StaffJwtService.verify lança e a mensagem é a de token
    // inválido, não mais a de header ausente.
    expect(corpo.message).toBe('Token inválido ou expirado');
  });
});

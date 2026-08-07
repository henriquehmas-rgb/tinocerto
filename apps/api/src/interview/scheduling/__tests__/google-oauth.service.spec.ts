import { Pool } from 'pg';
import { TenantContext } from '../../../database/tenant-context';
import { EnvelopeEncryptionService } from '../../../talent/envelope-encryption.service';
import { GoogleOAuthService } from '../google-oauth.service';
import { GoogleCalendarApiClient } from '../google-calendar-client';

describe('GoogleOAuthService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const oauthService = new GoogleOAuthService(new EnvelopeEncryptionService());

  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Calendar OAuth Ltda','00000000000090','test-tenant-00000000000090') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const u = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'organizador@example.com') RETURNING id`,
      [tenantId],
    );
    userId = u.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM google_calendar_connection WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('busca sem conexão devolve null', async () => {
    const conexao = await tenantContext.run(tenantId, (client) => oauthService.buscarConexao(client, tenantId, userId));
    expect(conexao).toBeNull();
  });

  it('salva, busca (refresh_token cifrado em repouso, decifra de volta ao original), remove', async () => {
    await tenantContext.run(tenantId, (client) =>
      oauthService.salvarConexao(client, tenantId, userId, {
        googleEmail: 'organizador@gmail.com',
        refreshToken: 'refresh-token-secreto-123',
      }),
    );

    const cru = await adminPool.query<{ refresh_token_encriptado: { ciphertext: string } }>(
      `SELECT refresh_token_encriptado FROM google_calendar_connection WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId],
    );
    expect(cru.rows[0].refresh_token_encriptado.ciphertext).not.toContain('refresh-token-secreto-123');

    const conexao = await tenantContext.run(tenantId, (client) => oauthService.buscarConexao(client, tenantId, userId));
    expect(conexao).toEqual({ googleEmail: 'organizador@gmail.com', refreshToken: 'refresh-token-secreto-123' });

    await tenantContext.run(tenantId, (client) => oauthService.removerConexao(client, tenantId, userId));
    const depois = await tenantContext.run(tenantId, (client) => oauthService.buscarConexao(client, tenantId, userId));
    expect(depois).toBeNull();
  });

  it('reconectar (mesmo usuário) sobrescreve a conexão anterior em vez de duplicar', async () => {
    await tenantContext.run(tenantId, (client) =>
      oauthService.salvarConexao(client, tenantId, userId, { googleEmail: 'primeiro@gmail.com', refreshToken: 'token-1' }),
    );
    await tenantContext.run(tenantId, (client) =>
      oauthService.salvarConexao(client, tenantId, userId, { googleEmail: 'segundo@gmail.com', refreshToken: 'token-2' }),
    );
    const contagem = await adminPool.query(
      `SELECT count(*) AS n FROM google_calendar_connection WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId],
    );
    expect(Number(contagem.rows[0].n)).toBe(1);
    const conexao = await tenantContext.run(tenantId, (client) => oauthService.buscarConexao(client, tenantId, userId));
    expect(conexao?.googleEmail).toBe('segundo@gmail.com');
    await tenantContext.run(tenantId, (client) => oauthService.removerConexao(client, tenantId, userId));
  });

  // Chamada real à API do Google Calendar -- mesma exceção já documentada
  // do projeto para chamada real e externa (ANTHROPIC_API_KEY/
  // OPENAI_API_KEY em model-router.service.spec.ts). Diferente da troca de
  // código de autorização (trocarCodigoPorConexao, que exige um `code` de
  // USO ÚNICO obtido interativamente numa tela de consentimento real e por
  // isso NÃO é replayable em CI), um refresh_token já obtido manualmente
  // uma vez É reutilizável indefinidamente -- por isso o gate aqui é sobre
  // GOOGLE_TEST_REFRESH_TOKEN, não sobre um `code` (decisão 14 da spec).
  const hasGoogleTestCreds = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_TEST_REFRESH_TOKEN,
  );
  const maybeIt = hasGoogleTestCreds ? it : it.skip;
  if (!hasGoogleTestCreds) {
    console.warn(
      'GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET/GOOGLE_TEST_REFRESH_TOKEN ausentes -- pulando teste de integração real com a API do Google Calendar',
    );
  }

  maybeIt('cria um evento real no Google Calendar com link do Meet, e limpa depois', async () => {
    const client = new GoogleCalendarApiClient();
    const resultado = await client.criarEvento(process.env.GOOGLE_TEST_REFRESH_TOKEN!, {
      resumo: 'Teste automatizado -- Fase 3b',
      inicio: new Date(Date.now() + 24 * 60 * 60 * 1000),
      duracaoMinutos: 30,
      timeZone: 'America/Sao_Paulo',
      attendeeEmails: [],
    });
    expect(resultado.googleEventId).toBeTruthy();
    expect(resultado.googleMeetLink).toMatch(/^https:\/\/meet\.google\.com\//);

    // Limpeza -- evita acumular eventos de teste na agenda real usada para
    // este propósito.
    const { google } = await import('googleapis');
    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_TEST_REFRESH_TOKEN });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await calendar.events.delete({ calendarId: 'primary', eventId: resultado.googleEventId });
  }, 30000);
});

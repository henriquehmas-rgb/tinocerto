import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { google } from 'googleapis';
import { EncryptedPayload, EnvelopeEncryptionService } from '../../talent/envelope-encryption.service';

export interface ConexaoGoogleCalendar {
  googleEmail: string;
  refreshToken: string;
}

function clienteOAuth() {
  // redirectUri só é exigido pelo SDK na etapa de troca de código
  // (getToken) -- gerarUrlDeAutorizacao também o usa para montar a URL de
  // consentimento, então ambos passam pelos 3 argumentos.
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

@Injectable()
export class GoogleOAuthService {
  constructor(private readonly envelopeEncryption: EnvelopeEncryptionService) {}

  gerarUrlDeAutorizacao(state: string): string {
    return clienteOAuth().generateAuthUrl({
      access_type: 'offline',
      // prompt=consent força o Google a reemitir refresh_token mesmo numa
      // RECONEXÃO (por padrão só o primeiro consentimento devolve um) --
      // sem isso, reconectar depois de revogar o acesso silenciosamente
      // deixaria de gravar um refresh_token novo, e a conexão ficaria
      // presa no valor antigo (já inválido).
      prompt: 'consent',
      // Privilégio mínimo -- ver spec "Riscos conhecidos": não dá para
      // listar/ler outros eventos do usuário com este escopo, deliberado.
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state,
    });
  }

  async trocarCodigoPorConexao(code: string): Promise<ConexaoGoogleCalendar> {
    const oauth2Client = clienteOAuth();
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        'Google não retornou refresh_token nesta troca de código -- reconexão deve solicitar prompt=consent',
      );
    }
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    if (!data.email) {
      throw new Error('Google não retornou e-mail da conta autorizada');
    }
    return { googleEmail: data.email, refreshToken: tokens.refresh_token };
  }

  async salvarConexao(
    client: PoolClient,
    tenantId: string,
    userId: string,
    conexao: ConexaoGoogleCalendar,
  ): Promise<void> {
    const encriptado: EncryptedPayload = this.envelopeEncryption.encrypt(conexao.refreshToken);
    await client.query(
      `INSERT INTO google_calendar_connection (tenant_id, user_id, google_email, refresh_token_encriptado)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, user_id) DO UPDATE
         SET google_email = EXCLUDED.google_email,
             refresh_token_encriptado = EXCLUDED.refresh_token_encriptado,
             atualizado_em = now()`,
      [tenantId, userId, conexao.googleEmail, JSON.stringify(encriptado)],
    );
  }

  async buscarConexao(client: PoolClient, tenantId: string, userId: string): Promise<ConexaoGoogleCalendar | null> {
    const result = await client.query<{ google_email: string; refresh_token_encriptado: EncryptedPayload }>(
      `SELECT google_email, refresh_token_encriptado FROM google_calendar_connection WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      googleEmail: row.google_email,
      refreshToken: this.envelopeEncryption.decrypt(row.refresh_token_encriptado),
    };
  }

  async removerConexao(client: PoolClient, tenantId: string, userId: string): Promise<void> {
    await client.query(`DELETE FROM google_calendar_connection WHERE tenant_id = $1 AND user_id = $2`, [
      tenantId,
      userId,
    ]);
  }
}

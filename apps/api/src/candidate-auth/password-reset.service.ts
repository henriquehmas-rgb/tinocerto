import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PoolClient } from 'pg';
import { EmailService } from './email.service';
import { PasswordService } from './password.service';
import { CandidateTokenService } from './candidate-token.service';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly emailService: EmailService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: CandidateTokenService,
  ) {}

  async requestReset(client: PoolClient, email: string): Promise<{ token?: string }> {
    const account = await client.query<{ id: string }>(`SELECT id FROM candidate_account WHERE lower(email) = lower($1)`, [
      email,
    ]);
    if (account.rows.length === 0) {
      // Não revela se o e-mail existe -- resolve normalmente sem token.
      return { token: undefined };
    }

    const token = randomBytes(32).toString('base64url');
    const expiraEm = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await client.query(
      `INSERT INTO candidate_password_reset_token (candidate_account_id, token_hash, expira_em) VALUES ($1, $2, $3)`,
      [account.rows[0].id, hashToken(token), expiraEm],
    );

    await this.emailService.send(email, 'Redefinição de senha', `Use este link para redefinir sua senha: /candidato/redefinir-senha?token=${token}`);

    return { token };
  }

  async resetPassword(client: PoolClient, presentedToken: string, novaSenha: string): Promise<void> {
    const presentedHash = hashToken(presentedToken);
    const result = await client.query<{
      id: string;
      candidate_account_id: string;
      expira_em: Date;
      usado_em: Date | null;
    }>(`SELECT id, candidate_account_id, expira_em, usado_em FROM candidate_password_reset_token WHERE token_hash = $1`, [
      presentedHash,
    ]);
    if (result.rows.length === 0) {
      throw new Error('Token de redefinição inválido');
    }
    const row = result.rows[0];
    if (row.usado_em !== null) {
      throw new Error('Token de redefinição já foi usado');
    }
    if (row.expira_em.getTime() < Date.now()) {
      throw new Error('Token de redefinição expirado');
    }

    const novaSenhaHash = await this.passwordService.hash(novaSenha);
    await client.query(`UPDATE candidate_account SET senha_hash = $1 WHERE id = $2`, [novaSenhaHash, row.candidate_account_id]);
    await client.query(`UPDATE candidate_password_reset_token SET usado_em = now() WHERE id = $1`, [row.id]);

    // Trocar a senha revoga todas as sessões existentes -- prática padrão
    // de segurança (se a senha vazou, um invasor com refresh token válido
    // não deve continuar autenticado depois da troca).
    await this.tokenService.revokeAll(client, row.candidate_account_id);
  }
}

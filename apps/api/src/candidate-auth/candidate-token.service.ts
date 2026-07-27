import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PoolClient } from 'pg';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class CandidateTokenService {
  async issue(client: PoolClient, candidateAccountId: string): Promise<{ token: string }> {
    const token = randomBytes(32).toString('base64url');
    const expiraEm = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await client.query(
      `INSERT INTO candidate_refresh_token (candidate_account_id, token_hash, expira_em) VALUES ($1, $2, $3)`,
      [candidateAccountId, hashToken(token), expiraEm],
    );
    return { token };
  }

  async rotate(client: PoolClient, presentedToken: string): Promise<{ token: string; candidateAccountId: string }> {
    const presentedHash = hashToken(presentedToken);
    const result = await client.query<{
      id: string;
      candidate_account_id: string;
      expira_em: Date;
      revogado_em: Date | null;
    }>(
      `SELECT id, candidate_account_id, expira_em, revogado_em FROM candidate_refresh_token WHERE token_hash = $1`,
      [presentedHash],
    );

    if (result.rows.length === 0) {
      throw new Error('Refresh token não encontrado');
    }
    const row = result.rows[0];

    if (row.revogado_em !== null) {
      // Token já usado/revogado sendo reapresentado -- sinal de roubo.
      // Revoga TODOS os tokens desta conta, não só este.
      await this.revokeAll(client, row.candidate_account_id);
      // `rotate` é sempre chamado dentro de `TenantContext.run`, que faz
      // ROLLBACK automático quando `fn` lança -- o que desfaria a revogação
      // de segurança que acabamos de gravar. Commit explícito aqui garante
      // que a revogação sobrevive; o ROLLBACK que o `TenantContext.run` fizer
      // em seguida vira um no-op inofensivo (não há mais transação aberta).
      await client.query('COMMIT');
      throw new Error('Refresh token já havia sido revogado -- possível reuso detectado, todos os tokens da conta foram revogados');
    }

    if (row.expira_em.getTime() < Date.now()) {
      throw new Error('Refresh token expirado');
    }

    await client.query(`UPDATE candidate_refresh_token SET revogado_em = now() WHERE id = $1`, [row.id]);

    const { token: newToken } = await this.issue(client, row.candidate_account_id);
    return { token: newToken, candidateAccountId: row.candidate_account_id };
  }

  async revokeAll(client: PoolClient, candidateAccountId: string): Promise<void> {
    await client.query(
      `UPDATE candidate_refresh_token SET revogado_em = now() WHERE candidate_account_id = $1 AND revogado_em IS NULL`,
      [candidateAccountId],
    );
  }
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { EncryptedPayload } from '../talent/envelope-encryption.service';
import { PasswordService } from './password.service';

export interface LoginInput {
  email: string;
  senha: string;
}

export interface LoginResult {
  userId: string;
  tenantId: string;
  roles: string[];
  mfaHabilitado: boolean;
}

@Injectable()
export class StaffAccountService {
  constructor(private readonly passwordService: PasswordService) {}

  async login(client: PoolClient, input: LoginInput): Promise<LoginResult> {
    // `user_account` tem FORCE ROW LEVEL SECURITY com uma policy RESTRICTIVE
    // que exige app.tenant_id já setado (ver identity_0003__user_account.sql)
    // -- mas login não sabe o tenant do usuário até achar a linha pelo
    // e-mail, exatamente o dado que essa policy pede pra liberar a leitura.
    // A analogia com CandidateAccountService.login não se sustenta aqui:
    // candidate_account é global, sem RLS nenhuma, então o SELECT direto
    // dela não tem nada pra contornar. Resolvido com
    // resolve_staff_login_by_email, function SECURITY DEFINER estreita
    // (só devolve as 4 colunas que login precisa) criada em
    // identity_0011__resolve_staff_login_by_email.sql, mesmo padrão de
    // resolve_tenant_id_by_slug (apps/api/src/public).
    const result = await client.query<{
      id: string;
      tenant_id: string;
      senha_hash: string | null;
      mfa_habilitado: boolean;
    }>(`SELECT id, tenant_id, senha_hash, mfa_habilitado FROM resolve_staff_login_by_email($1)`, [input.email]);

    const row = result.rows[0];
    if (!row || !row.senha_hash) {
      // UnauthorizedException com a mesma mensagem de "senha errada" --
      // mesmo raciocínio de CandidateAccountService.login: sem oráculo de
      // enumeração de e-mail cadastrado via mensagem de erro distinta.
      throw new UnauthorizedException('Credenciais inválidas');
    }
    const valid = await this.passwordService.verify(row.senha_hash, input.senha);
    if (!valid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // Agora que o tenant do usuário é conhecido, atualiza o GUC de sessão
    // dentro da MESMA transação/client antes de consultar role_assignment/
    // role (ambas com RESTRICTIVE tenant_isolation) -- mesmo mecanismo que
    // TenantContext.run usa (set_config com 3º argumento `true`, escopado à
    // transação atual), só que aplicado a meio da transação em vez de no
    // início dela, porque só agora o tenant_id correto é conhecido.
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [row.tenant_id]);

    const roles = await this.getRoles(client, row.id, row.tenant_id);

    return {
      userId: row.id,
      tenantId: row.tenant_id,
      roles,
      mfaHabilitado: row.mfa_habilitado,
    };
  }

  // Extraído de `login` (Task 5) para reúso em `StaffAuthController` (Task
  // 7): tanto `POST /login/mfa` (depois de validar o código TOTP, com o
  // tenant já resolvido pelo mfaChallengeToken) quanto `POST /refresh`
  // (depois de `StaffTokenService.rotate` devolver o par userId/tenantId)
  // precisam da mesma lista de papéis para assinar o access token, sem
  // duplicar a query em cada um.
  async getRoles(client: PoolClient, userId: string, tenantId: string): Promise<string[]> {
    const rolesResult = await client.query<{ nome: string }>(
      `SELECT r.nome FROM role_assignment ra JOIN role r ON r.id = ra.role_id WHERE ra.user_id = $1 AND ra.tenant_id = $2`,
      [userId, tenantId],
    );
    return rolesResult.rows.map((r) => r.nome);
  }

  // Task 7: MfaService.gerarSetup/gerarBackupCodes cifram o segredo/códigos
  // TOTP, mas quem persiste em `user_account` é este service -- único ponto
  // de acesso a essa tabela, mesmo padrão de todo outro controller do
  // projeto (nunca faz `client.query` direto, sempre delega a um service --
  // ver OfferController/DecisionController).
  async getMfaSecret(client: PoolClient, userId: string): Promise<EncryptedPayload | null> {
    const result = await client.query<{ mfa_secret_cifrado: EncryptedPayload | null }>(
      `SELECT mfa_secret_cifrado FROM user_account WHERE id = $1`,
      [userId],
    );
    return result.rows[0]?.mfa_secret_cifrado ?? null;
  }

  // Achado I1 da revisão final: `mfa/setup` sobrescrevia `mfa_secret_cifrado`
  // incondicionalmente, mesmo quando `mfa_habilitado` já era `true` -- uma
  // tentativa de re-setup abandonada, ou qualquer um de posse de um access
  // token roubado, podia silenciosamente substituir o segundo fator de um
  // usuário já configurado. `StaffAuthController.mfaSetup` usa este método
  // para saber, ANTES de gerar um novo secret, se precisa exigir o código
  // TOTP atual contra o secret EXISTENTE (só quando `habilitado` já é
  // `true` -- primeira configuração continua sem essa exigência).
  async getMfaState(client: PoolClient, userId: string): Promise<{ habilitado: boolean; secretCifrado: EncryptedPayload | null }> {
    const result = await client.query<{ mfa_habilitado: boolean; mfa_secret_cifrado: EncryptedPayload | null }>(
      `SELECT mfa_habilitado, mfa_secret_cifrado FROM user_account WHERE id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return { habilitado: row?.mfa_habilitado ?? false, secretCifrado: row?.mfa_secret_cifrado ?? null };
  }

  // Grava o secret recém-gerado sem habilitar MFA ainda -- `mfa_habilitado`
  // só vira `true` em `enableMfa`, depois que `POST /mfa/verify` confirmar
  // que o usuário configurou o authenticator corretamente (ver design spec,
  // seção de rotas). `JSON.stringify` explícito porque a coluna é `jsonb` --
  // mesmo padrão de `PersonService.criar` para `cpf_encriptado`.
  async setMfaSecret(client: PoolClient, userId: string, secretCifrado: EncryptedPayload): Promise<void> {
    await client.query(`UPDATE user_account SET mfa_secret_cifrado = $1 WHERE id = $2`, [
      JSON.stringify(secretCifrado),
      userId,
    ]);
  }

  async enableMfa(client: PoolClient, userId: string, backupCodesCifrados: EncryptedPayload[]): Promise<void> {
    await client.query(`UPDATE user_account SET mfa_habilitado = true, mfa_backup_codes_cifrados = $1 WHERE id = $2`, [
      JSON.stringify(backupCodesCifrados),
      userId,
    ]);
  }

  // Achado I2 da revisão final: `MfaService.verificarBackupCode` existia e
  // era testado em unidade, mas nada em `StaffAuthController` chamava --
  // backup codes eram gerados, mostrados ao usuário, prometidos como
  // recuperação, mas nunca podiam ser de fato apresentados de volta para
  // destravar um login. `getBackupCodes`/`updateBackupCodes` dão a
  // `loginMfa` o par ler-lista-cifrada / gravar-lista-já-sem-o-código-usado
  // que faltava -- mesmo padrão de `getMfaSecret`/`setMfaSecret` para o
  // secret TOTP.
  async getBackupCodes(client: PoolClient, userId: string): Promise<EncryptedPayload[]> {
    const result = await client.query<{ mfa_backup_codes_cifrados: EncryptedPayload[] | null }>(
      `SELECT mfa_backup_codes_cifrados FROM user_account WHERE id = $1`,
      [userId],
    );
    return result.rows[0]?.mfa_backup_codes_cifrados ?? [];
  }

  // Persiste a lista de backup codes já SEM o código recém-consumido --
  // `loginMfa` chama isto só depois de `MfaService.verificarBackupCode`
  // confirmar o código apresentado, para que ele nunca possa ser reusado
  // (uso único, como prometido na tela de configuração de MFA).
  async updateBackupCodes(client: PoolClient, userId: string, backupCodesCifrados: EncryptedPayload[]): Promise<void> {
    await client.query(`UPDATE user_account SET mfa_backup_codes_cifrados = $1 WHERE id = $2`, [
      JSON.stringify(backupCodesCifrados),
      userId,
    ]);
  }
}

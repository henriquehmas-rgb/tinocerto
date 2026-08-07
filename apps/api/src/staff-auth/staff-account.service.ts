import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PoolClient } from 'pg';
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

    const rolesResult = await client.query<{ nome: string }>(
      `SELECT r.nome FROM role_assignment ra JOIN role r ON r.id = ra.role_id WHERE ra.user_id = $1 AND ra.tenant_id = $2`,
      [row.id, row.tenant_id],
    );

    return {
      userId: row.id,
      tenantId: row.tenant_id,
      roles: rolesResult.rows.map((r) => r.nome),
      mfaHabilitado: row.mfa_habilitado,
    };
  }
}

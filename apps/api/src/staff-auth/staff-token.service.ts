import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PoolClient } from 'pg';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class StaffTokenService {
  async issue(client: PoolClient, userId: string, tenantId: string): Promise<{ token: string }> {
    const token = randomBytes(32).toString('base64url');
    const expiraEm = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await client.query(
      `INSERT INTO staff_refresh_token (user_id, tenant_id, token_hash, expira_em) VALUES ($1, $2, $3, $4)`,
      [userId, tenantId, hashToken(token), expiraEm],
    );
    return { token };
  }

  /**
   * IMPORTANTE -- invariante de transação (revisão de segurança, round 1):
   * quando reuso é detectado, este método executa um `COMMIT` explícito (ver
   * comentário mais abaixo, no ramo de reuso) antes de lançar, para que a
   * revogação de segurança sobreviva ao `ROLLBACK` automático que
   * `TenantContext.run` faria ao ver a exceção subir. Isso só é seguro porque,
   * hoje, `rotate` é sempre a ÚNICA operação dentro do `ctx.run(...)` que a
   * envolve (ver `__tests__/staff-token.service.spec.ts`). Se uma chamada
   * futura (ex.: `StaffAuthController.refresh`) fizer outras escritas no
   * MESMO `client`/transação antes de chamar `rotate`, esse `COMMIT`
   * tornaria essas escritas duráveis mesmo que o `ctx.run` como um todo lance
   * em seguida -- quebrando a garantia de tudo-ou-nada que toda outra chamada
   * de `TenantContext.run` neste projeto pode assumir. Sempre chame `rotate`
   * como a única operação de um `ctx.run(...)` isolado; nunca a combine com
   * outras escritas na mesma transação.
   */
  async rotate(
    client: PoolClient,
    presentedToken: string,
  ): Promise<{ token: string; userId: string; tenantId: string }> {
    const presentedHash = hashToken(presentedToken);
    const result = await client.query<{
      id: string;
      user_id: string;
      tenant_id: string;
      expira_em: Date;
    }>(`SELECT id, user_id, tenant_id, expira_em FROM staff_refresh_token WHERE token_hash = $1`, [presentedHash]);

    if (result.rows.length === 0) {
      // UnauthorizedException (não `Error` genérico) -- revisão de código
      // round 1: sem isso, o handler padrão do Nest transforma qualquer
      // `Error` não-HTTP num 500 "Internal server error" genérico, escondendo
      // de quem chamou que a causa real é um refresh token inválido (401),
      // não uma falha do servidor.
      throw new UnauthorizedException('Refresh token não encontrado');
    }
    const row = result.rows[0];

    // Transição atômica revogado_em: NULL -> now(), condicionada ao estado
    // anterior no próprio UPDATE (não num SELECT separado feito antes). Isto
    // fecha uma corrida TOCTOU (revisão de segurança, round 1): duas
    // requisições concorrentes apresentando o MESMO token (ex.: um token
    // roubado sendo usado em paralelo com o refresh legítimo do dono, ou um
    // retry de rede do próprio cliente) não podem mais ambas "vencer". A
    // cláusula `WHERE ... AND revogado_em IS NULL` só afeta a linha se ela
    // ainda não tiver sido revogada no momento em que o UPDATE a trava; sob
    // READ COMMITTED, uma segunda transação concorrente bloqueia na mesma
    // linha até a primeira commitar, e então reavalia essa cláusula contra o
    // estado já commitado -- portanto no máximo UMA das chamadas concorrentes
    // recebe `rowCount === 1`. A(s) outra(s) recebe(m) `rowCount === 0` e cai
    // no ramo de reuso abaixo, que é exatamente o comportamento que este
    // serviço existe para garantir.
    //
    // Esta checagem de reuso roda ANTES da checagem de expiração de propósito
    // (revisão de segurança, round 2): um token já revogado é sinal de
    // reuso/roubo independentemente de ele também estar expirado -- por
    // exemplo, um token roubado há muito tempo, já rotacionado pelo dono
    // legítimo, sendo reapresentado pelo atacante depois que o TTL original
    // também já passou. Se a checagem de expiração rodasse primeiro, esse
    // replay cairia no ramo de "expirado" (que não aciona `revokeAll`) e o
    // restante dos tokens vivos do usuário -- inclusive o filho legítimo
    // atual -- ficaria intocado, exatamente o cenário que este serviço existe
    // para prevenir.
    const revokeResult = await client.query<{ id: string }>(
      `UPDATE staff_refresh_token SET revogado_em = now() WHERE id = $1 AND revogado_em IS NULL RETURNING id`,
      [row.id],
    );

    if (revokeResult.rowCount === 0) {
      // Token já estava revogado -- seja porque já tinha sido rotacionado
      // antes (reuso "normal", não concorrente), seja porque uma requisição
      // concorrente venceu a corrida do UPDATE acima agora mesmo (reuso
      // "de corrida"). Nos dois casos é sinal de reuso/roubo: revoga TODOS
      // os tokens deste usuário, não só este -- mesmo que este token também
      // esteja expirado (ver comentário acima).
      await this.revokeAll(client, row.user_id);
      // Ver o comentário no topo deste método sobre este COMMIT explícito.
      await client.query('COMMIT');
      // UnauthorizedException -- ver comentário acima sobre o SELECT vazio;
      // mesmo raciocínio aqui.
      throw new UnauthorizedException(
        'Refresh token já havia sido revogado -- possível reuso detectado, todos os tokens do usuário foram revogados',
      );
    }

    // Só chegamos aqui se o token apresentado NÃO estava revogado (e acabamos
    // de revogá-lo nós mesmos, acima). Agora, e só agora, checamos expiração:
    // um token simplesmente expirado (nunca revogado, nunca reusado) não é em
    // si um sinal de roubo, então não aciona `revokeAll` -- só rejeita esta
    // apresentação.
    if (row.expira_em.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expirado');
    }

    const { token: newToken } = await this.issue(client, row.user_id, row.tenant_id);
    return { token: newToken, userId: row.user_id, tenantId: row.tenant_id };
  }

  async revokeAll(client: PoolClient, userId: string): Promise<void> {
    await client.query(
      `UPDATE staff_refresh_token SET revogado_em = now() WHERE user_id = $1 AND revogado_em IS NULL`,
      [userId],
    );
  }
}

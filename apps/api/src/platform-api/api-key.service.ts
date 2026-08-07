import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Pool, PoolClient } from 'pg';

// 'tnc_live_' (9 chars) + os primeiros 7 chars do random em base64url --
// não precisa ser segredo (é o que aparece em UI/logs, doc 03 §2.7), só
// precisa ser um identificador de lookup eficiente; UNIQUE em `prefixo`
// garante 0 ou 1 linha por resolve_api_key_by_prefix mesmo com poucos
// caracteres. A chave COMPLETA (32 chars de random, bem mais longa que o
// prefixo) é o segredo de verdade, comparado via hash abaixo -- nunca o
// prefixo sozinho autentica nada.
const KEY_PREFIX_LENGTH = 16;

export interface IssuedApiKey {
  id: string;
  rawKey: string;
  prefixo: string;
}

export interface AuthenticatedApiKey {
  tenantId: string;
  serviceAccountId: string;
  escopos: string[];
}

export interface ApiKeySummary {
  id: string;
  serviceAccountId: string;
  nomeServiceAccount: string;
  prefixo: string;
  escopos: string[];
  criadoEm: Date;
  revogadoEm: Date | null;
  expiraEm: Date | null;
}

// Mesmo algoritmo de person.service.ts (SHA-256 + pepper), pepper PRÓPRIO
// (API_KEY_HASH_PEPPER) -- ver design spec, decisão 11: reaproveitar o
// pepper de CPF acoplaria dois domínios de segredo sem relação nenhuma.
function hashApiKey(rawKey: string): string {
  const pepper = process.env.API_KEY_HASH_PEPPER;
  if (!pepper) {
    throw new Error('API_KEY_HASH_PEPPER ausente — ApiKeyService nunca deve hashear chave sem pepper configurado');
  }
  return createHash('sha256').update(`${rawKey}:${pepper}`).digest('hex');
}

// Comparação em tempo constante -- nunca ===/!== de string (vaza timing).
// sha256 em hex é sempre 64 chars; o length-check antes do
// timingSafeEqual é só defensivo (buffers de tamanho diferente lançam).
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

@Injectable()
export class ApiKeyService {
  constructor(private readonly pool: Pool) {}

  async issue(
    client: PoolClient,
    input: { tenantId: string; serviceAccountId: string; escopos: string[] },
  ): Promise<IssuedApiKey> {
    const rawKey = `tnc_live_${randomBytes(24).toString('base64url')}`;
    const prefixo = rawKey.slice(0, KEY_PREFIX_LENGTH);
    const hash = hashApiKey(rawKey);

    const result = await client.query<{ id: string }>(
      `INSERT INTO api_key (tenant_id, service_account_id, prefixo, hash, escopos)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.tenantId, input.serviceAccountId, prefixo, hash, input.escopos],
    );
    return { id: result.rows[0].id, rawKey, prefixo };
  }

  // Roda FORA de TenantContext.run de propósito -- tenant_id ainda não é
  // conhecido neste ponto, é justamente o que esta chamada resolve. Usa a
  // conexão crua app_runtime da pool (sem app.tenant_id setado);
  // resolve_api_key_by_prefix é SECURITY DEFINER e bypassa RLS de forma
  // estreita (só as 7 colunas do handshake, agora incluindo expira_em).
  async authenticate(rawKey: string): Promise<AuthenticatedApiKey | null> {
    if (!rawKey || rawKey.length < KEY_PREFIX_LENGTH) return null;
    const prefixo = rawKey.slice(0, KEY_PREFIX_LENGTH);

    const result = await this.pool.query<{
      id: string;
      tenant_id: string;
      service_account_id: string;
      hash: string;
      escopos: string[];
      revogado_em: Date | null;
      expira_em: Date | null;
    }>(
      `SELECT id, tenant_id, service_account_id, hash, escopos, revogado_em, expira_em FROM resolve_api_key_by_prefix($1)`,
      [prefixo],
    );

    const row = result.rows[0];
    // Mesma mensagem de erro para chave expirada, revogada, inexistente ou
    // hash divergente -- não dá oráculo de "qual dos quatro motivos foi".
    const expirada = row?.expira_em !== null && row?.expira_em !== undefined && row.expira_em <= new Date();
    if (!row || row.revogado_em || expirada) return null;

    const presentedHash = hashApiKey(rawKey);
    if (!safeCompare(presentedHash, row.hash)) return null;

    return { tenantId: row.tenant_id, serviceAccountId: row.service_account_id, escopos: row.escopos };
  }

  // Emite uma chave NOVA sob o MESMO service_account_id/escopos da antiga
  // -- preserva o vínculo de CRP (Task 1), que é por service_account_id,
  // através de toda rotação futura. Marca a antiga com expira_em = now() +
  // overlapDays -- ela continua autenticando até lá (overlap de verdade),
  // sem revogado_em (que continua significando "revogada AGORA", nunca
  // "vai expirar depois" -- os dois campos não se confundem).
  async rotate(
    client: PoolClient,
    input: { tenantId: string; oldApiKeyId: string; overlapDays?: number },
  ): Promise<IssuedApiKey> {
    const overlapDays = input.overlapDays ?? 7;
    const old = await client.query<{ service_account_id: string; escopos: string[] }>(
      `SELECT service_account_id, escopos FROM api_key WHERE id = $1 AND tenant_id = $2 AND revogado_em IS NULL`,
      [input.oldApiKeyId, input.tenantId],
    );
    if (old.rows.length === 0) {
      throw new NotFoundException('Chave de API não encontrada ou já revogada');
    }

    const novo = await this.issue(client, {
      tenantId: input.tenantId,
      serviceAccountId: old.rows[0].service_account_id,
      escopos: old.rows[0].escopos,
    });

    await client.query(
      `UPDATE api_key SET expira_em = now() + ($3 || ' days')::interval WHERE id = $1 AND tenant_id = $2`,
      [input.oldApiKeyId, input.tenantId, overlapDays],
    );

    return novo;
  }

  async revoke(client: PoolClient, input: { tenantId: string; apiKeyId: string }): Promise<void> {
    const result = await client.query(
      `UPDATE api_key SET revogado_em = now() WHERE id = $1 AND tenant_id = $2 AND revogado_em IS NULL`,
      [input.apiKeyId, input.tenantId],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('Chave de API não encontrada ou já revogada');
    }
  }

  async listByTenant(client: PoolClient, tenantId: string): Promise<ApiKeySummary[]> {
    const result = await client.query<{
      id: string;
      service_account_id: string;
      nome_service_account: string;
      prefixo: string;
      escopos: string[];
      criado_em: Date;
      revogado_em: Date | null;
      expira_em: Date | null;
    }>(
      `SELECT k.id, k.service_account_id, sa.nome AS nome_service_account, k.prefixo, k.escopos,
              k.criado_em, k.revogado_em, k.expira_em
         FROM api_key k
         JOIN service_account sa ON sa.id = k.service_account_id
        WHERE k.tenant_id = $1
        ORDER BY k.criado_em DESC`,
      [tenantId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      serviceAccountId: row.service_account_id,
      nomeServiceAccount: row.nome_service_account,
      prefixo: row.prefixo,
      escopos: row.escopos,
      criadoEm: row.criado_em,
      revogadoEm: row.revogado_em,
      expiraEm: row.expira_em,
    }));
  }
}

import { Injectable } from '@nestjs/common';
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
  // estreita (só as 6 colunas do handshake).
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
    }>(`SELECT id, tenant_id, service_account_id, hash, escopos, revogado_em FROM resolve_api_key_by_prefix($1)`, [
      prefixo,
    ]);

    const row = result.rows[0];
    if (!row || row.revogado_em) return null;

    const presentedHash = hashApiKey(rawKey);
    if (!safeCompare(presentedHash, row.hash)) return null;

    return { tenantId: row.tenant_id, serviceAccountId: row.service_account_id, escopos: row.escopos };
  }
}

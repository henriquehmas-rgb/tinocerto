// apps/api/src/platform-api/rate-limit-config.ts
//
// tenant.plano é `text NOT NULL DEFAULT 'entrada'` SEM CHECK constraint
// (migrations/identity_0002__tenant.sql) -- não existe um enum fechado no
// banco nem em nenhum outro lugar do código para os tiers pagos. `entrada`
// é o único valor que de fato já é gravado hoje (é o default da coluna);
// `starter`/`business` são uma decisão desta fatia (ver design spec,
// "Mapeamento de plano"), não uma leitura de convenção pré-existente.
export interface RateLimitTier {
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMIT_WINDOW_SECONDS = 60;

export const PLAN_RATE_LIMITS: Record<string, RateLimitTier> = {
  entrada: { limit: 60, windowSeconds: RATE_LIMIT_WINDOW_SECONDS },
  starter: { limit: 300, windowSeconds: RATE_LIMIT_WINDOW_SECONDS },
  business: { limit: 1200, windowSeconds: RATE_LIMIT_WINDOW_SECONDS },
};

// Fail-closed: qualquer plano fora do mapa -- incluindo 'enterprise' (doc
// 04 marca como "negociado em contrato", sem número fixo e sem coluna no
// schema para guardar um número por tenant), null, string vazia, ou erro
// de digitação -- cai no tier MAIS RESTRITIVO, nunca no mais permissivo
// por omissão.
export const RATE_LIMIT_FALLBACK_TIER: RateLimitTier = PLAN_RATE_LIMITS.entrada;

export function resolveRateLimitTier(plano: string | null | undefined): RateLimitTier {
  if (!plano) return RATE_LIMIT_FALLBACK_TIER;
  return PLAN_RATE_LIMITS[plano] ?? RATE_LIMIT_FALLBACK_TIER;
}

import { PLAN_RATE_LIMITS, RATE_LIMIT_FALLBACK_TIER, resolveRateLimitTier } from '../rate-limit-config';

describe('resolveRateLimitTier', () => {
  it('entrada -- 60 req/min', () => {
    expect(resolveRateLimitTier('entrada')).toEqual({ limit: 60, windowSeconds: 60 });
  });

  it('starter -- 300 req/min', () => {
    expect(resolveRateLimitTier('starter')).toEqual({ limit: 300, windowSeconds: 60 });
  });

  it('business -- 1200 req/min', () => {
    expect(resolveRateLimitTier('business')).toEqual({ limit: 1200, windowSeconds: 60 });
  });

  it.each([undefined, null, '', 'enterprise', 'valor-nunca-registrado'])(
    'plano desconhecido (%p) cai no fallback fail-closed (entrada)',
    (plano) => {
      expect(resolveRateLimitTier(plano as string | null | undefined)).toEqual(RATE_LIMIT_FALLBACK_TIER);
      expect(resolveRateLimitTier(plano as string | null | undefined)).toEqual(PLAN_RATE_LIMITS.entrada);
    },
  );
});

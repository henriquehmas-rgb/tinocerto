// apps/api/src/platform-api/rate-limit.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { DatabaseService } from '../database/database.service';
import { TenantContext } from '../database/tenant-context';
import { resolveRateLimitTier } from './rate-limit-config';

// INCR+EXPIRE atômico via Lua -- evita a janela de corrida (por mais
// estreita que seja) entre "INCR devolveu 1" e um EXPIRE separado, que
// deixaria a chave sem TTL para sempre se o processo morresse entre as
// duas chamadas. +5s de folga sobre a janela nominal é só tolerância a
// clock skew entre app e Redis -- cada janela já tem uma chave própria
// (windowIndex no nome), então a folga de TTL nunca estende o limite de
// ninguém, só evita que a chave morra um instante cedo demais.
const INCR_AND_EXPIRE_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

export interface RateLimitCheck {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number; // segundos até o fim da janela corrente (header 't=' e Retry-After)
  resetAtEpochSeconds: number; // timestamp Unix do fim da janela (X-RateLimit-Reset legado)
}

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly tenantContext: TenantContext;

  constructor(databaseService: DatabaseService) {
    this.redis = new Redis(process.env.REDIS_URL!);
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // Mesmo padrão de AdverseImpactConsumer/ResumeParsingConsumer (src/insights,
  // src/resume) -- fecha o cliente ioredis próprio no shutdown do módulo. Sem
  // isto, cada boot de AppModule (produção ou teste, ex.: os gates 4a/4b que
  // criam e destroem uma instância Nest inteira) vaza uma conexão TCP que
  // nunca fecha.
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  // `now` é injetável só para determinismo em teste (evita flake raro na
  // borda exata de um minuto) -- em produção, sempre o default Date.now().
  async checkAndIncrement(apiKeyId: string, tenantId: string, now: number = Date.now()): Promise<RateLimitCheck> {
    const plano = await this.resolvePlano(tenantId);
    const tier = resolveRateLimitTier(plano);

    const windowIndex = Math.floor(now / (tier.windowSeconds * 1000));
    const windowStartMs = windowIndex * tier.windowSeconds * 1000;
    const resetAtMs = windowStartMs + tier.windowSeconds * 1000;
    const key = `ratelimit:${apiKeyId}:${windowIndex}`;

    let current: number;
    try {
      current = (await this.redis.eval(INCR_AND_EXPIRE_LUA, 1, key, String(tier.windowSeconds + 5))) as number;
    } catch {
      // Fail-open (design spec, decisão adicional 13): Redis fora do ar
      // não pode derrubar a Plataforma API inteira. Sem contagem real
      // nesta chamada -- devolve "permitido, teto cheio" sem persistir
      // nada. RateLimitGuard trata isto como resposta sem garantia de
      // enforcement, não como erro.
      return {
        allowed: true,
        limit: tier.limit,
        remaining: tier.limit,
        resetSeconds: tier.windowSeconds,
        resetAtEpochSeconds: Math.floor(resetAtMs / 1000),
      };
    }

    return {
      allowed: current <= tier.limit,
      limit: tier.limit,
      remaining: Math.max(0, tier.limit - current),
      resetSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
      resetAtEpochSeconds: Math.floor(resetAtMs / 1000),
    };
  }

  // Leitura RLS-normal (TenantContext seta app.tenant_id; a policy de
  // `tenant` só libera a própria linha) -- decisão 2 do design spec exige
  // ler o plano AO VIVO a cada requisição, nunca cachear/duplicar em
  // api_key.
  private async resolvePlano(tenantId: string): Promise<string | null> {
    return this.tenantContext.run(tenantId, async (client) => {
      const result = await client.query<{ plano: string }>('SELECT plano FROM tenant WHERE id = $1', [tenantId]);
      return result.rows[0]?.plano ?? null;
    });
  }
}

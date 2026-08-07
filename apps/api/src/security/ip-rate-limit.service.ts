// apps/api/src/security/ip-rate-limit.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

// Achado da revisão consolidada pós-Fase 4: nenhum endpoint público
// voltado a candidato (login, register, request-password-reset, apply)
// tinha qualquer limite de taxa -- só a Plataforma API (Fase 4b) tinha,
// escopada a chamadores autenticados por API key com plano de tenant.
// Esses endpoints não têm api key nem plano; o limite aqui é fixo por IP,
// não por tenant. Mesmo padrão de INCR+EXPIRE atômico via Lua já usado em
// platform-api/rate-limit.service.ts (evita a janela de corrida entre
// "INCR devolveu 1" e um EXPIRE separado).
const INCR_AND_EXPIRE_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

export interface IpRateLimitCheck {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

@Injectable()
export class IpRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(IpRateLimitService.name);
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL!);
  }

  // Mesmo padrão dos consumers de outbox / RateLimitService -- fecha a
  // conexão ioredis própria no shutdown do módulo.
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  // `escopo` distingue rotas com limites diferentes (ex.: "login" vs
  // "register") sob o mesmo IP -- sem isso, esgotar o limite de login
  // esgotaria também o de register para o mesmo visitante. `now` só é
  // injetável para determinismo em teste.
  async checkAndIncrement(
    escopo: string,
    ip: string,
    limit: number,
    windowSeconds: number,
    now: number = Date.now(),
  ): Promise<IpRateLimitCheck> {
    const windowIndex = Math.floor(now / (windowSeconds * 1000));
    const windowStartMs = windowIndex * windowSeconds * 1000;
    const resetAtMs = windowStartMs + windowSeconds * 1000;
    const key = `iprate:${escopo}:${ip}:${windowIndex}`;

    let current: number;
    try {
      current = (await this.redis.eval(INCR_AND_EXPIRE_LUA, 1, key, String(windowSeconds + 5))) as number;
    } catch (err) {
      // Fail-open (mesma decisão de produto da Fase 4b): Redis fora do ar
      // não pode derrubar login/register/apply pra todo mundo. Achado da
      // revisão consolidada sobre o rate-limit irmão (platform-api):
      // fail-open SEM log nenhum torna a degradação do Redis invisível --
      // aqui já corrigido desde o início.
      this.logger.warn(`Fail-open: Redis indisponível ao checar rate limit de "${escopo}" para IP ${ip}`, err as Error);
      return { allowed: true, remaining: limit, resetSeconds: windowSeconds };
    }

    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      resetSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
    };
  }
}

// apps/api/src/security/ip-rate-limit.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IP_RATE_LIMIT_KEY = 'ipRateLimit';

export interface IpRateLimitOptions {
  escopo: string;
  limit: number;
  windowSeconds: number;
}

// Aplica junto de @UseGuards(IpRateLimitGuard) -- o guard lê esta
// metadata via Reflector para saber qual limite/janela usar nesta rota
// específica (rotas diferentes sob o mesmo IP têm limites diferentes,
// ex.: login mais apertado que apply).
export const IpRateLimit = (options: IpRateLimitOptions) => SetMetadata(IP_RATE_LIMIT_KEY, options);

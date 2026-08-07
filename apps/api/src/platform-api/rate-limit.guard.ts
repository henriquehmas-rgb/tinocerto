// apps/api/src/platform-api/rate-limit.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { RateLimitService } from './rate-limit.service';
import { RATE_LIMIT_WINDOW_SECONDS } from './rate-limit-config';
import { PlatformApiProblem } from './platform-api-problem';
import { RequestWithApiKeyContext } from './api-key.guard';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly rateLimitService: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & RequestWithApiKeyContext>();
    const res = context.switchToHttp().getResponse<Response>();

    // Sempre roda depois de ApiKeyGuard na cadeia de @UseGuards -- req.tenantId
    // e req.apiKeyId já estão populados aqui por construção da ORDEM dos
    // guards, nunca por uma checagem redundante deste guard.
    const check = await this.rateLimitService.checkAndIncrement(req.apiKeyId, req.tenantId);

    // draft-ietf-httpapi-ratelimit-headers (Structured Fields, RFC 8941) --
    // formato exato de 04-api-e-webhooks.md §2.1/§5, em TODA resposta que
    // atravessa este guard (sucesso e 429).
    res.setHeader('RateLimit-Policy', `"default";q=${check.limit};w=${RATE_LIMIT_WINDOW_SECONDS}`);
    res.setHeader('RateLimit', `"default";r=${check.remaining};t=${check.resetSeconds}`);
    // Legado, mantido em paralelo por 12 meses (doc 04 §5).
    res.setHeader('X-RateLimit-Limit', String(check.limit));
    res.setHeader('X-RateLimit-Remaining', String(check.remaining));
    res.setHeader('X-RateLimit-Reset', String(check.resetAtEpochSeconds));

    if (!check.allowed) {
      res.setHeader('Retry-After', String(check.resetSeconds));
      throw new PlatformApiProblem(
        429,
        'limite-de-taxa-excedido',
        'Limite de taxa excedido',
        `O limite de ${check.limit} requisições/min do plano atual foi excedido. Tente novamente em ${check.resetSeconds}s.`,
        { rate_limit_reason: 'tenant-rate' },
      );
    }
    return true;
  }
}

// apps/api/src/security/ip-rate-limit.guard.ts
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { IP_RATE_LIMIT_KEY, IpRateLimitOptions } from './ip-rate-limit.decorator';
import { IpRateLimitService } from './ip-rate-limit.service';

@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimitService: IpRateLimitService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<IpRateLimitOptions | undefined>(IP_RATE_LIMIT_KEY, context.getHandler());
    // Sem @IpRateLimit(...) na rota, o guard não faz nada -- nunca bloqueia
    // por omissão de configuração (fail-open por design, não por acidente).
    if (!options) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    // req.ip via Express -- correto para o processo rodando direto sem
    // proxy reverso na frente (estado atual). Se um dia isto rodar atrás
    // de um proxy (Traefik/nginx), `app.set('trust proxy', ...)` precisa
    // ser configurado em main.ts para req.ip refletir o IP real do
    // visitante em vez do IP do proxy -- não configurado aqui de
    // propósito, para não confiar cegamente em X-Forwarded-For sem que
    // exista de fato um proxy confiável na frente.
    const ip = req.ip ?? 'sem-ip';

    const check = await this.rateLimitService.checkAndIncrement(options.escopo, ip, options.limit, options.windowSeconds);

    res.setHeader('X-RateLimit-Limit', String(options.limit));
    res.setHeader('X-RateLimit-Remaining', String(check.remaining));

    if (!check.allowed) {
      res.setHeader('Retry-After', String(check.resetSeconds));
      throw new HttpException(
        {
          type: 'https://tinocerto.dev/problems/limite-de-taxa-excedido',
          title: 'Limite de taxa excedido',
          status: HttpStatus.TOO_MANY_REQUESTS,
          detail: `Limite de ${options.limit} requisições/min excedido para este IP. Tente novamente em ${check.resetSeconds}s.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

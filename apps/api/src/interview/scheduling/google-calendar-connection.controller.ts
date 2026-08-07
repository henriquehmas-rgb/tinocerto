import { Controller, Delete, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { TenantContext } from '../../database/tenant-context';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';
import { CerbosCheck } from '../../authz/cerbos-check.decorator';
import { GoogleOAuthService } from './google-oauth.service';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

const OAUTH_STATE_PREFIX = 'oauth-state:google-calendar:';
const OAUTH_STATE_TTL_SEGUNDOS = 600;

@Controller('v1/calendar-connections/google')
export class GoogleCalendarConnectionController {
  private readonly tenantContext: TenantContext;
  private readonly redis: Redis;

  constructor(
    private readonly oauthService: GoogleOAuthService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
    this.redis = new Redis(process.env.REDIS_URL!);
  }

  @Get('auth-url')
  @UseGuards(CerbosGuard)
  @CerbosCheck('google_calendar_connection', 'connect')
  async gerarUrlDeAutorizacao(@Req() req: RequestWithAuthContext) {
    const state = randomUUID();
    await this.redis.set(
      `${OAUTH_STATE_PREFIX}${state}`,
      JSON.stringify({ tenantId: req.tenantId, userId: req.userId }),
      'EX',
      OAUTH_STATE_TTL_SEGUNDOS,
    );
    return { url: this.oauthService.gerarUrlDeAutorizacao(state) };
  }

  // SEM CerbosGuard e FORA do TenantResolutionMiddleware (ver Step 5): o
  // navegador chega aqui vindo do redirect de consentimento do Google, sem
  // nenhum header de autenticação da aplicação. tenant/usuário são
  // recuperados do `state` gravado acima (TTL de 10 minutos), nunca de um
  // header.
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const raw = state ? await this.redis.get(`${OAUTH_STATE_PREFIX}${state}`) : null;
    if (!raw || !code) {
      res.type('html').send('<p>Link de conexão expirado ou inválido. Feche esta janela e peça um novo link.</p>');
      return;
    }
    await this.redis.del(`${OAUTH_STATE_PREFIX}${state}`);
    const { tenantId, userId } = JSON.parse(raw) as { tenantId: string; userId: string };

    try {
      const conexao = await this.oauthService.trocarCodigoPorConexao(code);
      await this.tenantContext.run(tenantId, (client) =>
        this.oauthService.salvarConexao(client, tenantId, userId, conexao),
      );
      res
        .type('html')
        .send(`<p>Calendário do Google conectado (${conexao.googleEmail}). Você já pode fechar esta janela.</p>`);
    } catch (err) {
      res
        .type('html')
        .send(
          `<p>Não foi possível conectar o calendário: ${(err as Error).message}. Feche esta janela e tente novamente.</p>`,
        );
    }
  }

  @Get()
  @UseGuards(CerbosGuard)
  @CerbosCheck('google_calendar_connection', 'read')
  async status(@Req() req: RequestWithAuthContext) {
    const conexao = await this.tenantContext.run(req.tenantId, (client) =>
      this.oauthService.buscarConexao(client, req.tenantId, req.userId),
    );
    return conexao ? { connected: true, googleEmail: conexao.googleEmail } : { connected: false };
  }

  @Delete()
  @UseGuards(CerbosGuard)
  @CerbosCheck('google_calendar_connection', 'disconnect')
  async desconectar(@Req() req: RequestWithAuthContext) {
    await this.tenantContext.run(req.tenantId, (client) =>
      this.oauthService.removerConexao(client, req.tenantId, req.userId),
    );
    return { disconnected: true };
  }
}

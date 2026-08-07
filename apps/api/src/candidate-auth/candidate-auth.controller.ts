import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CandidateAccountService } from './candidate-account.service';
import { CandidateTokenService } from './candidate-token.service';
import { CandidateJwtService } from './candidate-jwt.service';
import { CandidateAuthGuard } from './candidate-auth.guard';
import { PasswordResetService } from './password-reset.service';
import { IpRateLimit } from '../security/ip-rate-limit.decorator';
import { IpRateLimitGuard } from '../security/ip-rate-limit.guard';

const PLACEHOLDER_TENANT = '00000000-0000-0000-0000-000000000000';

class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  senha!: string;

  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsString()
  @IsNotEmpty()
  cpf!: string;
}

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  senha!: string;
}

class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

class RequestResetDto {
  @IsEmail()
  email!: string;
}

class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(8)
  novaSenha!: string;
}

interface RequestWithCandidate extends Request {
  candidateAccountId: string;
  personId: string;
}

@Controller('v1/candidate/auth')
export class CandidateAuthController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly accountService: CandidateAccountService,
    private readonly tokenService: CandidateTokenService,
    private readonly jwtService: CandidateJwtService,
    private readonly passwordResetService: PasswordResetService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // Achado da revisão consolidada: sem isto, spam de contas/e-mails era
  // trivial (nenhum limite em lugar nenhum). 5/min por IP -- generoso o
  // bastante para uso humano legítimo, apertado o bastante para travar
  // automação simples.
  @IpRateLimit({ escopo: 'candidate-register', limit: 5, windowSeconds: 60 })
  @UseGuards(IpRateLimitGuard)
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.tenantContext.run(PLACEHOLDER_TENANT, async (client) => {
      const { candidateAccountId, personId } = await this.accountService.register(client, dto);
      const { token: refreshToken } = await this.tokenService.issue(client, candidateAccountId);
      const accessToken = this.jwtService.sign({ candidateAccountId, personId });
      return { accessToken, refreshToken };
    });
  }

  // Achado da revisão consolidada: sem isto, brute-force/credential-
  // stuffing contra senha não tinha nenhum obstáculo além do custo do
  // Argon2id por tentativa. 10/min por IP.
  @IpRateLimit({ escopo: 'candidate-login', limit: 10, windowSeconds: 60 })
  @UseGuards(IpRateLimitGuard)
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.tenantContext.run(PLACEHOLDER_TENANT, async (client) => {
      const { candidateAccountId, personId } = await this.accountService.login(client, dto);
      const { token: refreshToken } = await this.tokenService.issue(client, candidateAccountId);
      const accessToken = this.jwtService.sign({ candidateAccountId, personId });
      return { accessToken, refreshToken };
    });
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshDto) {
    return this.tenantContext.run(PLACEHOLDER_TENANT, async (client) => {
      const { token: refreshToken, candidateAccountId } = await this.tokenService.rotate(client, dto.refreshToken);
      const account = await client.query<{ person_id: string }>(
        `SELECT person_id FROM candidate_account WHERE id = $1`,
        [candidateAccountId],
      );
      const accessToken = this.jwtService.sign({ candidateAccountId, personId: account.rows[0].person_id });
      return { accessToken, refreshToken };
    });
  }

  @Post('logout')
  @UseGuards(CandidateAuthGuard)
  async logout(@Req() req: RequestWithCandidate) {
    await this.tenantContext.run(PLACEHOLDER_TENANT, (client) =>
      this.tokenService.revokeAll(client, req.candidateAccountId),
    );
    return { ok: true };
  }

  // Achado da revisão consolidada: sem isto, um atacante podia
  // repetidamente pedir redefinição de senha para o e-mail de uma
  // vítima, gerando spam e múltiplas chances de captura do token
  // (achado separado, já corrigido, sobre o token vazar em log).
  @IpRateLimit({ escopo: 'candidate-password-reset-request', limit: 5, windowSeconds: 60 })
  @UseGuards(IpRateLimitGuard)
  @Post('request-password-reset')
  async requestPasswordReset(@Body() dto: RequestResetDto) {
    await this.tenantContext.run(PLACEHOLDER_TENANT, (client) => this.passwordResetService.requestReset(client, dto.email));
    // Resposta idêntica exista ou não o e-mail -- ver nota de design da Task 6.
    return { ok: true };
  }

  // Defesa em profundidade: o token de 32 bytes já é inadivinhável por
  // força bruta em qualquer taxa realista, mas limitar aqui também é
  // barato e evita esgotamento de recursos por flood.
  @IpRateLimit({ escopo: 'candidate-password-reset-confirm', limit: 10, windowSeconds: 60 })
  @UseGuards(IpRateLimitGuard)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.tenantContext.run(PLACEHOLDER_TENANT, (client) =>
      this.passwordResetService.resetPassword(client, dto.token, dto.novaSenha),
    );
    return { ok: true };
  }
}

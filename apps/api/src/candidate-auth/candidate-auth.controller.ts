import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CandidateAccountService } from './candidate-account.service';
import { CandidateTokenService } from './candidate-token.service';
import { CandidateJwtService } from './candidate-jwt.service';
import { CandidateAuthGuard } from './candidate-auth.guard';

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
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.tenantContext.run(PLACEHOLDER_TENANT, async (client) => {
      const { candidateAccountId, personId } = await this.accountService.register(client, dto);
      const { token: refreshToken } = await this.tokenService.issue(client, candidateAccountId);
      const accessToken = this.jwtService.sign({ candidateAccountId, personId });
      return { accessToken, refreshToken };
    });
  }

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
}

import { Body, Controller, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { StaffOnboardingService } from './staff-onboarding.service';
import { StaffAccountService } from './staff-account.service';
import { StaffTokenService } from './staff-token.service';
import { StaffJwtService } from './staff-jwt.service';
import { MfaService } from './mfa.service';
import { IpRateLimit } from '../security/ip-rate-limit.decorator';
import { IpRateLimitGuard } from '../security/ip-rate-limit.guard';

// Único endpoint deste módulo (junto com `login`/`login/mfa`/`refresh`) que
// roda ANTES de haver tenant conhecido -- mesmo padrão de
// `PLACEHOLDER_TENANT` em `candidate-auth.controller.ts`, mas aqui
// `onboarding` cria o tenant de verdade (não usa o placeholder, gera o UUID
// real dentro de `StaffOnboardingService.onboard`). `login`/`login/mfa`/
// `refresh` usam o placeholder porque, como `CandidateAuthController.login`,
// o tenant do usuário só é conhecido DEPOIS do lookup por e-mail (`login`),
// da decodificação do `mfaChallengeToken` (`login/mfa`), ou do lookup do
// refresh token apresentado pelo hash (`refresh`) -- nenhum dos três tem
// tenant disponível antes disso.
const PLACEHOLDER_TENANT = '00000000-0000-0000-0000-000000000000';

class OnboardingDto {
  @IsString()
  @IsNotEmpty()
  nomeEmpresa!: string;

  @IsString()
  @IsNotEmpty()
  cnpj!: string;

  @IsEmail()
  emailAdmin!: string;

  @IsString()
  @MinLength(8)
  senhaAdmin!: string;
}

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  senha!: string;
}

class LoginMfaDto {
  @IsString()
  @IsNotEmpty()
  mfaChallengeToken!: string;

  // Achado I2 da revisão final: aceita TANTO um código TOTP de 6 dígitos
  // QUANTO um backup code (formato diferente, ver `MfaService.gerarBackupCodes`)
  // no mesmo campo -- `StaffAuthController.loginMfa` tenta TOTP primeiro e
  // cai para backup code se a verificação de TOTP falhar. Mesmo campo (não
  // um campo novo) porque é exatamente o que o frontend já envia hoje (ver
  // `apps/web/app/staff/mfa/*`), sem exigir nenhuma mudança de contrato do
  // lado do cliente.
  @IsString()
  @IsNotEmpty()
  codigoTotp!: string;
}

class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

class MfaSetupDto {
  // Achado I1 da revisão final: só é exigido quando o usuário JÁ tem MFA
  // habilitado (reconfiguração) -- na primeira configuração (`mfa_habilitado`
  // ainda `false`) este campo é ignorado, mesmo comportamento de antes.
  @IsOptional()
  @IsString()
  codigoTotp?: string;
}

class MfaVerifyDto {
  @IsString()
  @IsNotEmpty()
  codigoTotp!: string;
}

// `logout`/`mfa/setup`/`mfa/verify` NÃO entram no `.exclude(...)` de
// `TenantResolutionMiddleware` em `AppModule` -- exigem tenant/usuário já
// resolvidos a partir de um access token válido, então o middleware já
// popula `req.tenantId`/`req.userId`/`req.userRoles` antes do controller ser
// chamado -- mesmo padrão de `DecisionController`/`OfferController`.
//
// `refresh` FOI removida dessa lista (achado C1 da revisão final): exigir
// access token válido para alcançar `/refresh` inutilizava o próprio
// propósito da rota, que existe justamente para quando o access token JÁ
// expirou. `refresh` agora entra no `.exclude(...)` junto com
// `onboarding`/`login`/`login/mfa` -- o refresh token opaco apresentado no
// corpo (não o access token) é a credencial, e `StaffTokenService.rotate`
// resolve `userId`/`tenantId` a partir da própria linha do banco (ver
// `resolve_staff_refresh_token_by_hash`, identity_0013).
interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

@Controller('v1/staff/auth')
export class StaffAuthController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly onboardingService: StaffOnboardingService,
    private readonly accountService: StaffAccountService,
    private readonly tokenService: StaffTokenService,
    private readonly jwtService: StaffJwtService,
    private readonly mfaService: MfaService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // Achado C2 da revisão final: nenhuma rota deste controller tinha limite
  // de taxa (ao contrário de todo endpoint análogo de
  // `CandidateAuthController`) -- onboarding self-service sem limite é
  // superfície de spam de tenants/CNPJs. 5/min por IP, mesmo limite de
  // `candidate-auth.controller.ts#register`.
  @IpRateLimit({ escopo: 'staff-onboarding', limit: 5, windowSeconds: 60 })
  @UseGuards(IpRateLimitGuard)
  @Post('onboarding')
  async onboarding(@Body() dto: OnboardingDto) {
    const { tenantId, userId } = await this.onboardingService.onboard(dto);
    return this.tenantContext.run(tenantId, async (client) => {
      const { token: refreshToken } = await this.tokenService.issue(client, userId, tenantId);
      // Onboarding sempre cria o primeiro usuário com o papel `admin_tenant`
      // (ver `StaffOnboardingService.onboard`) -- não há necessidade de
      // consultar `role_assignment` de volta, o papel já é conhecido aqui.
      const accessToken = this.jwtService.sign({ userId, tenantId, roles: ['admin_tenant'] });
      return { accessToken, refreshToken };
    });
  }

  // Achado C2 da revisão final: brute-force/credential-stuffing contra
  // senha de staff não tinha nenhum obstáculo além do custo do Argon2id
  // por tentativa. 10/min por IP, mesmo limite de
  // `candidate-auth.controller.ts#login`.
  @IpRateLimit({ escopo: 'staff-login', limit: 10, windowSeconds: 60 })
  @UseGuards(IpRateLimitGuard)
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.tenantContext.run(PLACEHOLDER_TENANT, async (client) => {
      const result = await this.accountService.login(client, dto);
      if (result.mfaHabilitado) {
        // Nunca os tokens finais quando MFA está habilitado -- só o
        // challenge de curta duração, consumido em `login/mfa`.
        const mfaChallengeToken = this.jwtService.signMfaChallenge({
          userId: result.userId,
          tenantId: result.tenantId,
        });
        return { mfaChallengeToken };
      }
      const { token: refreshToken } = await this.tokenService.issue(client, result.userId, result.tenantId);
      const accessToken = this.jwtService.sign({ userId: result.userId, tenantId: result.tenantId, roles: result.roles });
      return { accessToken, refreshToken };
    });
  }

  // Achado C2 da revisão final -- este é o gap mais grave dos sete: sem
  // limite, o código TOTP de 6 dígitos podia ser atacado por força bruta
  // sem nenhum obstáculo durante toda a janela de 5min de vida do
  // `mfaChallengeToken` (10^6 combinações, sem contador de tentativas nem
  // invalidação do challenge). 10/min por IP -- não impede todo ataque
  // dentro da janela de 5min, mas eleva o custo de ~10^6 tentativas
  // livres para ~50 tentativas possíveis, e é o mesmo limite já aplicado
  // a login/senha em todo o projeto.
  @IpRateLimit({ escopo: 'staff-login-mfa', limit: 10, windowSeconds: 60 })
  @UseGuards(IpRateLimitGuard)
  @Post('login/mfa')
  async loginMfa(@Body() dto: LoginMfaDto) {
    let challenge: { userId: string; tenantId: string };
    try {
      challenge = this.jwtService.verifyMfaChallenge(dto.mfaChallengeToken);
    } catch {
      throw new UnauthorizedException('mfaChallengeToken inválido ou expirado');
    }

    return this.tenantContext.run(challenge.tenantId, async (client) => {
      const secretCifrado = await this.accountService.getMfaSecret(client, challenge.userId);
      let codigoValido = secretCifrado ? await this.mfaService.verificarCodigo(secretCifrado, dto.codigoTotp) : false;

      // Achado I2 da revisão final: `MfaService.verificarBackupCode` existia
      // e era testado em unidade, mas nenhum controller o chamava -- o
      // frontend promete literalmente que backup codes destravam o login se
      // o authenticator for perdido (ver `apps/web/app/staff/mfa/configurar/
      // page.tsx`), uma promessa que o sistema não conseguia cumprir. TOTP
      // primeiro (caminho comum); só consulta/tenta backup code se o TOTP
      // falhar -- evita o custo de decifrar a lista de backup codes na
      // maioria dos logins.
      if (!codigoValido) {
        const backupCifrados = await this.accountService.getBackupCodes(client, challenge.userId);
        const backupResult = this.mfaService.verificarBackupCode(backupCifrados, dto.codigoTotp);
        if (backupResult.valido) {
          codigoValido = true;
          // Consome o backup code usado -- persiste a lista já SEM ele, para
          // que não possa ser reapresentado (uso único, como prometido ao
          // usuário na tela de configuração de MFA).
          await this.accountService.updateBackupCodes(client, challenge.userId, backupResult.restantes);
        }
      }

      if (!codigoValido) {
        throw new UnauthorizedException('Código TOTP inválido');
      }

      const roles = await this.accountService.getRoles(client, challenge.userId, challenge.tenantId);
      const { token: refreshToken } = await this.tokenService.issue(client, challenge.userId, challenge.tenantId);
      const accessToken = this.jwtService.sign({ userId: challenge.userId, tenantId: challenge.tenantId, roles });
      return { accessToken, refreshToken };
    });
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshDto) {
    // Igual a `login`/`login/mfa`: o tenant do dono do refresh token não é
    // conhecido até `StaffTokenService.rotate` achar a linha pelo hash do
    // token apresentado (ver `resolve_staff_refresh_token_by_hash`,
    // identity_0013) -- abre com o mesmo `PLACEHOLDER_TENANT`, e `rotate`
    // faz `set_config('app.tenant_id', ...)` assim que o tenant real é
    // conhecido, antes de qualquer escrita.
    return this.tenantContext.run(PLACEHOLDER_TENANT, async (client) => {
      const rotated = await this.tokenService.rotate(client, dto.refreshToken);
      // Papéis atuais, não os do momento da última emissão -- se o usuário
      // ganhou/perdeu papel entre um refresh e outro, o novo access token
      // reflete o estado corrente.
      const roles = await this.accountService.getRoles(client, rotated.userId, rotated.tenantId);
      const accessToken = this.jwtService.sign({ userId: rotated.userId, tenantId: rotated.tenantId, roles });
      return { accessToken, refreshToken: rotated.token };
    });
  }

  @Post('logout')
  async logout(@Req() req: RequestWithAuthContext) {
    await this.tenantContext.run(req.tenantId, (client) => this.tokenService.revokeAll(client, req.userId));
    return { ok: true };
  }

  @Post('mfa/setup')
  async mfaSetup(@Body() dto: MfaSetupDto, @Req() req: RequestWithAuthContext) {
    return this.tenantContext.run(req.tenantId, async (client) => {
      // Achado I1 da revisão final: sem isto, `mfa/setup` sobrescrevia
      // `mfa_secret_cifrado` incondicionalmente, mesmo com MFA já habilitado
      // -- uma tentativa de re-setup abandonada, ou qualquer um de posse de
      // um access token roubado, podia silenciosamente substituir o segundo
      // fator de um usuário já configurado. Só exige o TOTP ATUAL quando já
      // existe um MFA habilitado (reconfiguração); a primeira configuração
      // continua sem essa exigência -- não há segredo anterior contra o qual
      // provar posse.
      const estadoAtual = await this.accountService.getMfaState(client, req.userId);
      if (estadoAtual.habilitado) {
        const codigoAtualValido = estadoAtual.secretCifrado
          ? await this.mfaService.verificarCodigo(estadoAtual.secretCifrado, dto.codigoTotp ?? '')
          : false;
        if (!codigoAtualValido) {
          throw new UnauthorizedException('Código TOTP atual necessário para reconfigurar o MFA');
        }
      }

      const { secretCifrado, qrCodeDataUri } = await this.mfaService.gerarSetup();
      // Não habilita MFA ainda -- só grava o secret pendente. `mfa_habilitado`
      // só vira `true` em `mfa/verify`, depois de confirmar que o usuário
      // configurou o authenticator corretamente.
      await this.accountService.setMfaSecret(client, req.userId, secretCifrado);
      return { qrCodeDataUri };
    });
  }

  // Achado C2 da revisão final: mesmo raciocínio de `login/mfa` -- código
  // TOTP de 6 dígitos sem limite de taxa é atacável por força bruta.
  // 10/min por IP.
  @IpRateLimit({ escopo: 'staff-mfa-verify', limit: 10, windowSeconds: 60 })
  @UseGuards(IpRateLimitGuard)
  @Post('mfa/verify')
  async mfaVerify(@Body() dto: MfaVerifyDto, @Req() req: RequestWithAuthContext) {
    return this.tenantContext.run(req.tenantId, async (client) => {
      const secretCifrado = await this.accountService.getMfaSecret(client, req.userId);
      const codigoValido = secretCifrado ? await this.mfaService.verificarCodigo(secretCifrado, dto.codigoTotp) : false;
      if (!codigoValido) {
        throw new UnauthorizedException('Código TOTP inválido');
      }

      // Backup codes devolvidos em texto claro só desta vez -- nunca mais
      // recuperáveis depois (só os hashes/cifrados ficam no banco).
      const { codigos, cifrados } = this.mfaService.gerarBackupCodes();
      await this.accountService.enableMfa(client, req.userId, cifrados);
      return { backupCodes: codigos };
    });
  }
}

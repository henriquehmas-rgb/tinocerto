import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { Pool } from 'pg';
import { StaffAuthController } from '../staff-auth.controller';
import { StaffOnboardingService } from '../staff-onboarding.service';
import { StaffAccountService } from '../staff-account.service';
import { StaffTokenService } from '../staff-token.service';
import { StaffJwtService } from '../staff-jwt.service';
import { MfaService } from '../mfa.service';
import { DatabaseService } from '../../database/database.service';

describe('StaffAuthController', () => {
  // Mesmo achado de `decision.controller.spec.ts`/`offer.controller.spec.ts`:
  // `TenantContext.run` (usado internamente pelo controller) chama
  // `pool.connect()` de verdade mesmo com todos os services mockados --
  // precisa ser um Pool real conectável, fechado em afterEach, senão o
  // processo Jest não encerra sozinho.
  let pool: Pool;

  afterEach(async () => {
    await pool.end();
  });

  interface Overrides {
    onboardingService?: Partial<StaffOnboardingService>;
    accountService?: Partial<StaffAccountService>;
    tokenService?: Partial<StaffTokenService>;
    jwtService?: Partial<StaffJwtService>;
    mfaService?: Partial<MfaService>;
  }

  async function build(overrides: Overrides = {}) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const moduleRef = await Test.createTestingModule({
      controllers: [StaffAuthController],
      providers: [
        {
          provide: StaffOnboardingService,
          useValue: { onboard: jest.fn(), ...overrides.onboardingService },
        },
        {
          provide: StaffAccountService,
          useValue: {
            login: jest.fn(),
            getRoles: jest.fn(),
            getMfaSecret: jest.fn(),
            setMfaSecret: jest.fn(),
            enableMfa: jest.fn(),
            ...overrides.accountService,
          },
        },
        {
          provide: StaffTokenService,
          useValue: { issue: jest.fn(), rotate: jest.fn(), revokeAll: jest.fn(), ...overrides.tokenService },
        },
        {
          provide: StaffJwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
            signMfaChallenge: jest.fn(),
            verifyMfaChallenge: jest.fn(),
            ...overrides.jwtService,
          },
        },
        {
          provide: MfaService,
          useValue: {
            gerarSetup: jest.fn(),
            verificarCodigo: jest.fn(),
            gerarBackupCodes: jest.fn(),
            verificarBackupCode: jest.fn(),
            ...overrides.mfaService,
          },
        },
        { provide: DatabaseService, useValue: { pool } },
      ],
    }).compile();

    return moduleRef.get(StaffAuthController);
  }

  it('onboarding delega para StaffOnboardingService.onboard e devolve tokens emitidos internamente', async () => {
    const onboard = jest.fn().mockResolvedValue({ tenantId: 'tenant-1', userId: 'user-1' });
    const issue = jest.fn().mockResolvedValue({ token: 'refresh-abc' });
    const sign = jest.fn().mockReturnValue('access-abc');

    const controller = await build({
      onboardingService: { onboard },
      tokenService: { issue },
      jwtService: { sign },
    });

    const dto = {
      nomeEmpresa: 'Empresa X',
      cnpj: '00000000000191',
      emailAdmin: 'admin@empresax.com',
      senhaAdmin: 'senha-123456',
    };

    const result = await controller.onboarding(dto as never);

    expect(onboard).toHaveBeenCalledWith(dto);
    expect(issue).toHaveBeenCalledWith(expect.anything(), 'user-1', 'tenant-1');
    expect(sign).toHaveBeenCalledWith({ userId: 'user-1', tenantId: 'tenant-1', roles: ['admin_tenant'] });
    expect(result).toEqual({ accessToken: 'access-abc', refreshToken: 'refresh-abc' });
  });

  it('login sem MFA habilitado devolve accessToken/refreshToken diretamente', async () => {
    const login = jest
      .fn()
      .mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1', roles: ['admin_tenant'], mfaHabilitado: false });
    const issue = jest.fn().mockResolvedValue({ token: 'refresh-abc' });
    const sign = jest.fn().mockReturnValue('access-abc');

    const controller = await build({ accountService: { login }, tokenService: { issue }, jwtService: { sign } });

    const result = await controller.login({ email: 'a@b.com', senha: 'x' } as never);

    expect(result).toEqual({ accessToken: 'access-abc', refreshToken: 'refresh-abc' });
    expect(sign).toHaveBeenCalledWith({ userId: 'user-1', tenantId: 'tenant-1', roles: ['admin_tenant'] });
  });

  it('login com MFA habilitado devolve mfaChallengeToken, não os tokens finais', async () => {
    const login = jest
      .fn()
      .mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1', roles: ['admin_tenant'], mfaHabilitado: true });
    const signMfaChallenge = jest.fn().mockReturnValue('challenge-abc');
    const issue = jest.fn();
    const sign = jest.fn();

    const controller = await build({
      accountService: { login },
      jwtService: { signMfaChallenge, sign },
      tokenService: { issue },
    });

    const result = await controller.login({ email: 'a@b.com', senha: 'x' } as never);

    expect(result).toEqual({ mfaChallengeToken: 'challenge-abc' });
    expect(signMfaChallenge).toHaveBeenCalledWith({ userId: 'user-1', tenantId: 'tenant-1' });
    expect(issue).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it('login/mfa com código certo devolve os tokens finais', async () => {
    const verifyMfaChallenge = jest.fn().mockReturnValue({ userId: 'user-1', tenantId: 'tenant-1' });
    const getMfaSecret = jest.fn().mockResolvedValue({ ciphertext: 'x', iv: 'y', authTag: 'z', wrappedDek: 'w' });
    const getRoles = jest.fn().mockResolvedValue(['admin_tenant']);
    const verificarCodigo = jest.fn().mockResolvedValue(true);
    const issue = jest.fn().mockResolvedValue({ token: 'refresh-abc' });
    const sign = jest.fn().mockReturnValue('access-abc');

    const controller = await build({
      jwtService: { verifyMfaChallenge, sign },
      accountService: { getMfaSecret, getRoles },
      mfaService: { verificarCodigo },
      tokenService: { issue },
    });

    const result = await controller.loginMfa({ mfaChallengeToken: 'challenge-abc', codigoTotp: '123456' } as never);

    expect(verifyMfaChallenge).toHaveBeenCalledWith('challenge-abc');
    expect(verificarCodigo).toHaveBeenCalledWith(
      { ciphertext: 'x', iv: 'y', authTag: 'z', wrappedDek: 'w' },
      '123456',
    );
    expect(sign).toHaveBeenCalledWith({ userId: 'user-1', tenantId: 'tenant-1', roles: ['admin_tenant'] });
    expect(result).toEqual({ accessToken: 'access-abc', refreshToken: 'refresh-abc' });
  });

  it('login/mfa com código errado lança 401', async () => {
    const verifyMfaChallenge = jest.fn().mockReturnValue({ userId: 'user-1', tenantId: 'tenant-1' });
    const getMfaSecret = jest.fn().mockResolvedValue({ ciphertext: 'x', iv: 'y', authTag: 'z', wrappedDek: 'w' });
    const verificarCodigo = jest.fn().mockResolvedValue(false);
    const issue = jest.fn();

    const controller = await build({
      jwtService: { verifyMfaChallenge },
      accountService: { getMfaSecret },
      mfaService: { verificarCodigo },
      tokenService: { issue },
    });

    await expect(
      controller.loginMfa({ mfaChallengeToken: 'challenge-abc', codigoTotp: '000000' } as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(issue).not.toHaveBeenCalled();
  });

  it('login/mfa com mfaChallengeToken inválido/expirado lança 401', async () => {
    const verifyMfaChallenge = jest.fn().mockImplementation(() => {
      throw new Error('jwt expired');
    });

    const controller = await build({ jwtService: { verifyMfaChallenge } });

    await expect(
      controller.loginMfa({ mfaChallengeToken: 'expirado', codigoTotp: '123456' } as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('refresh delega para StaffTokenService.rotate', async () => {
    const rotate = jest.fn().mockResolvedValue({ token: 'refresh-novo', userId: 'user-1', tenantId: 'tenant-1' });
    const getRoles = jest.fn().mockResolvedValue(['admin_tenant']);
    const sign = jest.fn().mockReturnValue('access-abc');

    const controller = await build({ tokenService: { rotate }, accountService: { getRoles }, jwtService: { sign } });

    const result = await controller.refresh({ refreshToken: 'refresh-antigo' } as never, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      userRoles: [],
    } as never);

    expect(rotate).toHaveBeenCalledWith(expect.anything(), 'refresh-antigo');
    expect(result).toEqual({ accessToken: 'access-abc', refreshToken: 'refresh-novo' });
  });

  it('logout delega para StaffTokenService.revokeAll', async () => {
    const revokeAll = jest.fn().mockResolvedValue(undefined);

    const controller = await build({ tokenService: { revokeAll } });

    const result = await controller.logout({ tenantId: 'tenant-1', userId: 'user-1', userRoles: [] } as never);

    expect(revokeAll).toHaveBeenCalledWith(expect.anything(), 'user-1');
    expect(result).toEqual({ ok: true });
  });
});

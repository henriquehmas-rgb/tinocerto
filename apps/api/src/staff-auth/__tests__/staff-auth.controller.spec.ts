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
import { IpRateLimitGuard } from '../../security/ip-rate-limit.guard';

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
            // Achado I1 da revisão final: default "sem MFA habilitado ainda"
            // -- cobre todo teste que não mexe com reconfiguração, sem
            // precisar sobrescrever em cada `build(...)`.
            getMfaState: jest.fn().mockResolvedValue({ habilitado: false, secretCifrado: null }),
            setMfaSecret: jest.fn(),
            enableMfa: jest.fn(),
            // Achado I2 da revisão final: default "sem backup codes" -- cobre
            // todo teste de `login/mfa` que não exercita o fallback de
            // backup code.
            getBackupCodes: jest.fn().mockResolvedValue([]),
            updateBackupCodes: jest.fn(),
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
            // Achado I2 da revisão final: default "código não é um backup
            // code válido" -- `verificarBackupCode` real devolveria isto
            // para qualquer lista vazia (default de `getBackupCodes` acima).
            verificarBackupCode: jest.fn().mockReturnValue({ valido: false, restantes: [] }),
            ...overrides.mfaService,
          },
        },
        { provide: DatabaseService, useValue: { pool } },
      ],
    })
      // Achado C2 da revisão final: `@UseGuards(IpRateLimitGuard)` nas rotas
      // deste controller faz o `DependenciesScanner` do Nest registrar
      // `IpRateLimitGuard` como injectable deste módulo de teste e
      // instanciá-lo de verdade no `compile()` -- exigindo `IpRateLimitService`
      // (que fala com Redis) mesmo esses testes nunca passando pelo pipeline
      // HTTP de guards (chamam os métodos do controller diretamente). Mesmo
      // padrão de `candidate-auth.controller.spec.ts`.
      .overrideGuard(IpRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

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

  // Achado I2 da revisão final: `MfaService.verificarBackupCode` existia e
  // era testado em unidade, mas nada em `StaffAuthController` o chamava --
  // backup codes prometidos como recuperação nunca podiam de fato destravar
  // um login. `login/mfa` agora tenta TOTP primeiro; se falhar, tenta o
  // mesmo valor como backup code.
  it('login/mfa com TOTP errado mas backup code válido completa o login e consome o backup code (uso único)', async () => {
    const verifyMfaChallenge = jest.fn().mockReturnValue({ userId: 'user-1', tenantId: 'tenant-1' });
    const getMfaSecret = jest.fn().mockResolvedValue({ ciphertext: 'x', iv: 'y', authTag: 'z', wrappedDek: 'w' });
    const verificarCodigo = jest.fn().mockResolvedValue(false);
    const cifradosOriginais = ['cif1-cifrado', 'cif2-cifrado', 'cif3-cifrado'];
    const cifradosRestantes = ['cif1-cifrado', 'cif3-cifrado'];
    const getBackupCodes = jest.fn().mockResolvedValue(cifradosOriginais);
    const verificarBackupCode = jest.fn().mockReturnValue({ valido: true, restantes: cifradosRestantes });
    const updateBackupCodes = jest.fn().mockResolvedValue(undefined);
    const getRoles = jest.fn().mockResolvedValue(['admin_tenant']);
    const issue = jest.fn().mockResolvedValue({ token: 'refresh-abc' });
    const sign = jest.fn().mockReturnValue('access-abc');

    const controller = await build({
      jwtService: { verifyMfaChallenge, sign },
      accountService: { getMfaSecret, getRoles, getBackupCodes, updateBackupCodes },
      mfaService: { verificarCodigo, verificarBackupCode },
      tokenService: { issue },
    });

    const result = await controller.loginMfa({ mfaChallengeToken: 'challenge-abc', codigoTotp: 'ab12cd34ef' } as never);

    expect(verificarCodigo).toHaveBeenCalledWith(expect.anything(), 'ab12cd34ef');
    expect(getBackupCodes).toHaveBeenCalledWith(expect.anything(), 'user-1');
    expect(verificarBackupCode).toHaveBeenCalledWith(cifradosOriginais, 'ab12cd34ef');
    // O backup code usado é removido da lista persistida -- não pode ser reapresentado.
    expect(updateBackupCodes).toHaveBeenCalledWith(expect.anything(), 'user-1', cifradosRestantes);
    expect(result).toEqual({ accessToken: 'access-abc', refreshToken: 'refresh-abc' });
  });

  it('login/mfa com TOTP errado E backup code inválido lança 401, sem consumir nenhum backup code', async () => {
    const verifyMfaChallenge = jest.fn().mockReturnValue({ userId: 'user-1', tenantId: 'tenant-1' });
    const getMfaSecret = jest.fn().mockResolvedValue({ ciphertext: 'x', iv: 'y', authTag: 'z', wrappedDek: 'w' });
    const verificarCodigo = jest.fn().mockResolvedValue(false);
    const verificarBackupCode = jest.fn().mockReturnValue({ valido: false, restantes: ['cif1-cifrado'] });
    const updateBackupCodes = jest.fn();
    const issue = jest.fn();

    const controller = await build({
      jwtService: { verifyMfaChallenge },
      accountService: { getMfaSecret, updateBackupCodes },
      mfaService: { verificarCodigo, verificarBackupCode },
      tokenService: { issue },
    });

    await expect(
      controller.loginMfa({ mfaChallengeToken: 'challenge-abc', codigoTotp: 'nada-disso-serve' } as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(updateBackupCodes).not.toHaveBeenCalled();
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

    // Achado C1 da revisão final: `refresh` não recebe mais `@Req()` -- não
    // depende de `req.tenantId`/`req.userId` (a rota saiu do escopo do
    // `TenantResolutionMiddleware`, ver `app.module.ts`). O tenant/usuário
    // dono do token vêm de `StaffTokenService.rotate`, mockado acima.
    const result = await controller.refresh({ refreshToken: 'refresh-antigo' } as never);

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

  it('mfa/setup (1ª configuração, MFA ainda não habilitado) delega para MfaService.gerarSetup e StaffAccountService.setMfaSecret, devolve o QR code', async () => {
    const gerarSetup = jest
      .fn()
      .mockResolvedValue({ secretCifrado: { ciphertext: 'x', iv: 'y', authTag: 'z', wrappedDek: 'w' }, qrCodeDataUri: 'data:image/png;base64,abc' });
    const setMfaSecret = jest.fn().mockResolvedValue(undefined);

    const controller = await build({
      mfaService: { gerarSetup },
      accountService: { setMfaSecret },
    });

    // getMfaState usa o default do build() (habilitado: false) -- 1ª
    // configuração não exige codigoTotp.
    const result = await controller.mfaSetup({} as never, { tenantId: 'tenant-1', userId: 'user-1', userRoles: [] } as never);

    expect(gerarSetup).toHaveBeenCalled();
    expect(setMfaSecret).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { ciphertext: 'x', iv: 'y', authTag: 'z', wrappedDek: 'w' },
    );
    expect(result).toEqual({ qrCodeDataUri: 'data:image/png;base64,abc' });
  });

  // Achado I1 da revisão final: reconfiguração (MFA já habilitado) exige o
  // TOTP atual -- sem isto, um access token roubado (ou um re-setup
  // abandonado) podia silenciosamente substituir o segundo fator já
  // configurado do usuário.
  it('mfa/setup com MFA JÁ habilitado e código TOTP atual certo permite reconfigurar', async () => {
    const secretExistente = { ciphertext: 'existente', iv: 'y', authTag: 'z', wrappedDek: 'w' };
    const secretNovo = { ciphertext: 'novo', iv: 'y', authTag: 'z', wrappedDek: 'w' };
    const getMfaState = jest.fn().mockResolvedValue({ habilitado: true, secretCifrado: secretExistente });
    const verificarCodigo = jest.fn().mockResolvedValue(true);
    const gerarSetup = jest.fn().mockResolvedValue({ secretCifrado: secretNovo, qrCodeDataUri: 'data:image/png;base64,novo' });
    const setMfaSecret = jest.fn().mockResolvedValue(undefined);

    const controller = await build({
      accountService: { getMfaState, setMfaSecret },
      mfaService: { verificarCodigo, gerarSetup },
    });

    const result = await controller.mfaSetup(
      { codigoTotp: '123456' } as never,
      { tenantId: 'tenant-1', userId: 'user-1', userRoles: [] } as never,
    );

    expect(verificarCodigo).toHaveBeenCalledWith(secretExistente, '123456');
    expect(setMfaSecret).toHaveBeenCalledWith(expect.anything(), 'user-1', secretNovo);
    expect(result).toEqual({ qrCodeDataUri: 'data:image/png;base64,novo' });
  });

  it('mfa/setup com MFA JÁ habilitado e SEM código TOTP (ou código errado) lança 401 e NÃO sobrescreve o secret', async () => {
    const getMfaState = jest
      .fn()
      .mockResolvedValue({ habilitado: true, secretCifrado: { ciphertext: 'x', iv: 'y', authTag: 'z', wrappedDek: 'w' } });
    const verificarCodigo = jest.fn().mockResolvedValue(false);
    const setMfaSecret = jest.fn();

    const controller = await build({
      accountService: { getMfaState, setMfaSecret },
      mfaService: { verificarCodigo },
    });

    await expect(
      controller.mfaSetup({} as never, { tenantId: 'tenant-1', userId: 'user-1', userRoles: [] } as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(setMfaSecret).not.toHaveBeenCalled();
  });

  it('mfa/verify com código certo habilita MFA e devolve os backup codes', async () => {
    const getMfaSecret = jest.fn().mockResolvedValue({ ciphertext: 'x', iv: 'y', authTag: 'z', wrappedDek: 'w' });
    const verificarCodigo = jest.fn().mockResolvedValue(true);
    const gerarBackupCodes = jest
      .fn()
      .mockReturnValue({ codigos: ['abc123', 'def456'], cifrados: ['cif1', 'cif2'] });
    const enableMfa = jest.fn().mockResolvedValue(undefined);

    const controller = await build({
      accountService: { getMfaSecret, enableMfa },
      mfaService: { verificarCodigo, gerarBackupCodes },
    });

    const result = await controller.mfaVerify(
      { codigoTotp: '123456' } as never,
      { tenantId: 'tenant-1', userId: 'user-1', userRoles: [] } as never,
    );

    expect(verificarCodigo).toHaveBeenCalledWith(
      { ciphertext: 'x', iv: 'y', authTag: 'z', wrappedDek: 'w' },
      '123456',
    );
    expect(enableMfa).toHaveBeenCalledWith(expect.anything(), 'user-1', ['cif1', 'cif2']);
    expect(result).toEqual({ backupCodes: ['abc123', 'def456'] });
  });

  it('mfa/verify com código errado lança 401', async () => {
    const getMfaSecret = jest.fn().mockResolvedValue({ ciphertext: 'x', iv: 'y', authTag: 'z', wrappedDek: 'w' });
    const verificarCodigo = jest.fn().mockResolvedValue(false);
    const enableMfa = jest.fn();

    const controller = await build({
      accountService: { getMfaSecret, enableMfa },
      mfaService: { verificarCodigo },
    });

    await expect(
      controller.mfaVerify(
        { codigoTotp: '000000' } as never,
        { tenantId: 'tenant-1', userId: 'user-1', userRoles: [] } as never,
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(enableMfa).not.toHaveBeenCalled();
  });

  // I1 da revisão de coerência do Painel do Recrutador: recrutador não
  // tinha nenhum jeito de descobrir o próprio userId de staff.
  it('GET me devolve userId/tenantId/roles direto do JWT decodificado (sem tocar banco)', async () => {
    const controller = await build();

    const result = await controller.me({
      tenantId: 'tenant-1',
      userId: 'user-1',
      userRoles: ['recrutador'],
    } as never);

    expect(result).toEqual({ userId: 'user-1', tenantId: 'tenant-1', roles: ['recrutador'] });
  });
});

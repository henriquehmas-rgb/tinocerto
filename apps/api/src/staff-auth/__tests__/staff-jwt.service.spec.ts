import jwt from 'jsonwebtoken';
import { StaffJwtService } from '../staff-jwt.service';

describe('StaffJwtService', () => {
  beforeAll(() => {
    process.env.STAFF_JWT_SECRET ??= 'segredo-de-teste-nao-usar-em-producao';
  });

  it('sign/verify roundtrip preserva userId, tenantId e roles', () => {
    const service = new StaffJwtService();
    const token = service.sign({ userId: 'user-1', tenantId: 'tenant-1', roles: ['admin_tenant'] });
    const decoded = service.verify(token);
    expect(decoded).toEqual({ userId: 'user-1', tenantId: 'tenant-1', roles: ['admin_tenant'] });
  });

  it('rejeita token assinado com segredo diferente', () => {
    const service = new StaffJwtService();
    const outroSegredoAntes = process.env.STAFF_JWT_SECRET;
    process.env.STAFF_JWT_SECRET = 'outro-segredo-completamente-diferente';
    const serviceComOutroSegredo = new StaffJwtService();
    const tokenForjado = serviceComOutroSegredo.sign({ userId: 'user-1', tenantId: 'tenant-1', roles: [] });
    process.env.STAFF_JWT_SECRET = outroSegredoAntes;

    expect(() => service.verify(tokenForjado)).toThrow();
  });

  it('rejeita token expirado', () => {
    const service = new StaffJwtService();
    const token = service.sign({ userId: 'user-1', tenantId: 'tenant-1', roles: [] }, '0s');
    expect(() => service.verify(token)).toThrow();
  });

  // Task 7 -- token de desafio de MFA, mesmo segredo, discriminador
  // explícito (`tipo: 'mfa_challenge'`) para nunca ser confundido com um
  // access token real.
  it('signMfaChallenge/verifyMfaChallenge roundtrip preserva userId e tenantId', () => {
    const service = new StaffJwtService();
    const token = service.signMfaChallenge({ userId: 'user-1', tenantId: 'tenant-1' });
    const decoded = service.verifyMfaChallenge(token);
    expect(decoded).toEqual({ userId: 'user-1', tenantId: 'tenant-1' });
  });

  it('verifyMfaChallenge rejeita um access token normal (sem o discriminador tipo:mfa_challenge)', () => {
    const service = new StaffJwtService();
    const accessToken = service.sign({ userId: 'user-1', tenantId: 'tenant-1', roles: ['admin_tenant'] });
    expect(() => service.verifyMfaChallenge(accessToken)).toThrow();
  });

  // Task 8 (CRÍTICO, corrigido nesta task) -- confusão de tokens no sentido
  // inverso do teste acima: um `mfa_challenge` (emitido só depois da senha
  // correta, ANTES do segundo fator) nunca pode ser aceito por `verify`
  // como se fosse um access token completo. Antes da correção, `verify` não
  // checava discriminador nenhum e devolvia normalmente
  // `{ userId, tenantId, roles: undefined }` para um `mfa_challenge` --
  // `TenantResolutionMiddleware` aceitava esse token como autenticação
  // completa, permitindo a um atacante que só sabe a senha da vítima
  // sequestrar o segundo fator dela via `mfa/setup`/`mfa/verify`.
  it('verify (access token) rejeita um mfaChallengeToken -- discriminador tipo:access ausente', () => {
    const service = new StaffJwtService();
    const challenge = service.signMfaChallenge({ userId: 'user-1', tenantId: 'tenant-1' });
    expect(() => service.verify(challenge)).toThrow();
  });

  it('verify rejeita um token cujo payload tem roles que não é array (defesa contra req.userRoles=undefined vazando para downstream)', () => {
    const service = new StaffJwtService();
    const tokenSemRolesArray = jwt.sign(
      { userId: 'user-1', tenantId: 'tenant-1', tipo: 'access' },
      process.env.STAFF_JWT_SECRET as string,
      { expiresIn: '15m' },
    );
    expect(() => service.verify(tokenSemRolesArray)).toThrow();
  });

  it('rejeita mfaChallengeToken expirado', () => {
    const service = new StaffJwtService();
    const token = service.signMfaChallenge({ userId: 'user-1', tenantId: 'tenant-1' }, '0s');
    expect(() => service.verifyMfaChallenge(token)).toThrow();
  });
});

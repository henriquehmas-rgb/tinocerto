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

  it('verify (access token) não é enganado por um mfa_challenge -- o discriminador não vaza para o shape de StaffJwtPayload, mas o token continua criptograficamente válido; a checagem de tipo fica a cargo de quem consome cada método', () => {
    const service = new StaffJwtService();
    const challenge = service.signMfaChallenge({ userId: 'user-1', tenantId: 'tenant-1' });
    // `verify` não faz a checagem de discriminador (só `verifyMfaChallenge`
    // faz) -- por isso o controller SEMPRE chama `verifyMfaChallenge` em
    // `login/mfa`, nunca `verify`, para um token vindo desse campo.
    const decoded = service.verify(challenge);
    expect(decoded.userId).toBe('user-1');
    expect(decoded.tenantId).toBe('tenant-1');
    expect(decoded.roles).toBeUndefined();
  });

  it('rejeita mfaChallengeToken expirado', () => {
    const service = new StaffJwtService();
    const token = service.signMfaChallenge({ userId: 'user-1', tenantId: 'tenant-1' }, '0s');
    expect(() => service.verifyMfaChallenge(token)).toThrow();
  });
});

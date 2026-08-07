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
});

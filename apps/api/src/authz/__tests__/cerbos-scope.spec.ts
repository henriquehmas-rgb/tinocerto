import { CerbosService } from '../cerbos.service';

describe('Cerbos — regra de escopo para service_account em application', () => {
  const cerbos = new CerbosService(process.env.CERBOS_HTTP_URL!);
  const tenantId = '11111111-1111-1111-1111-111111111146';

  it('service_account com escopo applications:read -- read permitido', async () => {
    const decision = await cerbos.check(
      { id: 'sa-1', roles: ['service_account'], attr: { tenant_id: tenantId, scopes: ['applications:read'] } },
      { kind: 'application', id: 'app-1', attr: { tenant_id: tenantId } },
      ['read'],
    );
    expect(decision.read).toBe(true);
  });

  it('service_account SEM applications:read (ex.: só requisitions:read) -- read negado', async () => {
    const decision = await cerbos.check(
      { id: 'sa-2', roles: ['service_account'], attr: { tenant_id: tenantId, scopes: ['requisitions:read'] } },
      { kind: 'application', id: 'app-1', attr: { tenant_id: tenantId } },
      ['read'],
    );
    expect(decision.read).toBe(false);
  });

  it('service_account sem NENHUM escopo -- read negado', async () => {
    const decision = await cerbos.check(
      { id: 'sa-3', roles: ['service_account'], attr: { tenant_id: tenantId, scopes: [] } },
      { kind: 'application', id: 'app-1', attr: { tenant_id: tenantId } },
      ['read'],
    );
    expect(decision.read).toBe(false);
  });

  it('roles internos existentes (recrutador) continuam funcionando -- regra nova não quebrou as antigas', async () => {
    const decision = await cerbos.check(
      { id: 'user-1', roles: ['recrutador'], attr: { tenant_id: tenantId } },
      { kind: 'application', id: 'app-1', attr: { tenant_id: tenantId } },
      ['read'],
    );
    expect(decision.read).toBe(true);
  });
});

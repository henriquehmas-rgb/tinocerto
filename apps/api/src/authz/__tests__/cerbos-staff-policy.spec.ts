import { CerbosService } from '../cerbos.service';
import { CERBOS_CHECK_KEY, CerbosCheckMetadata } from '../cerbos-check.decorator';
import { StaffController } from '../../staff-auth/staff.controller';

function acaoRealDoControllerParaListar(): string {
  const metadata = Reflect.getMetadata(CERBOS_CHECK_KEY, StaffController.prototype.listar) as CerbosCheckMetadata;
  return metadata.action;
}

describe('Cerbos — policy de staff (GET /v1/staff)', () => {
  const cerbos = new CerbosService(process.env.CERBOS_HTTP_URL!);
  const tenantId = '11111111-1111-1111-1111-111111111147';

  it('admin_tenant pode executar a acao real que StaffController.listar exige, contra a policy real', async () => {
    const decision = await cerbos.check(
      { id: 'admin-1', roles: ['admin_tenant'], attr: { tenant_id: tenantId } },
      { kind: 'staff', id: 'lista', attr: { tenant_id: tenantId } },
      [acaoRealDoControllerParaListar()],
    );
    expect(decision[acaoRealDoControllerParaListar()]).toBe(true);
  });

  it('recrutador pode listar a equipe', async () => {
    const decision = await cerbos.check(
      { id: 'rec-1', roles: ['recrutador'], attr: { tenant_id: tenantId } },
      { kind: 'staff', id: 'lista', attr: { tenant_id: tenantId } },
      ['list'],
    );
    expect(decision.list).toBe(true);
  });

  it('gestor_vaga pode listar a equipe', async () => {
    const decision = await cerbos.check(
      { id: 'gestor-1', roles: ['gestor_vaga'], attr: { tenant_id: tenantId } },
      { kind: 'staff', id: 'lista', attr: { tenant_id: tenantId } },
      ['list'],
    );
    expect(decision.list).toBe(true);
  });

  it('entrevistador NAO pode listar a equipe -- fora dos papeis elegiveis para vaga', async () => {
    const decision = await cerbos.check(
      { id: 'entrev-1', roles: ['entrevistador'], attr: { tenant_id: tenantId } },
      { kind: 'staff', id: 'lista', attr: { tenant_id: tenantId } },
      ['list'],
    );
    expect(decision.list).toBe(false);
  });

  it('a acao "read" (diferente da action real usada pelo controller) e negada -- prova que a policy nao libera tudo por engano', async () => {
    const decision = await cerbos.check(
      { id: 'admin-2', roles: ['admin_tenant'], attr: { tenant_id: tenantId } },
      { kind: 'staff', id: 'lista', attr: { tenant_id: tenantId } },
      ['read'],
    );
    expect(decision.read).toBe(false);
  });

  it('tenant cruzado -- nega mesmo com papel elegivel', async () => {
    const decision = await cerbos.check(
      { id: 'admin-3', roles: ['admin_tenant'], attr: { tenant_id: tenantId } },
      { kind: 'staff', id: 'lista', attr: { tenant_id: 'outro-tenant' } },
      ['list'],
    );
    expect(decision.list).toBe(false);
  });
});

// apps/api/src/staff-auth/__tests__/staff-onboarding.service.spec.ts
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { PasswordService } from '../password.service';
import { StaffOnboardingService } from '../staff-onboarding.service';

describe('StaffOnboardingService.onboard', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const passwordService = new PasswordService();
  const service = new StaffOnboardingService(tenantContext, passwordService);

  let tenantIdCriado: string | undefined;

  afterAll(async () => {
    if (tenantIdCriado) {
      // role_assignment referencia user_account via FK -- precisa ser
      // apagado antes, senão o DELETE em user_account viola a constraint
      // role_assignment_user_id_fkey (desvio do exemplo original do brief).
      await adminPool.query('DELETE FROM role_assignment WHERE tenant_id = $1', [tenantIdCriado]);
      await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantIdCriado]);
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantIdCriado]);
    }
    await adminPool.end();
    await appPool.end();
  });

  it('cria um tenant novo e o primeiro user_account com role admin_tenant', async () => {
    const resultado = await service.onboard({
      nomeEmpresa: 'Empresa Onboarding Teste Ltda',
      cnpj: '00000000000210',
      emailAdmin: 'admin-onboarding-210@example.com',
      senhaAdmin: 'senha-forte-onboarding-123',
    });
    tenantIdCriado = resultado.tenantId;

    const tenantRow = await adminPool.query('SELECT razao_social, cnpj FROM tenant WHERE id = $1', [resultado.tenantId]);
    expect(tenantRow.rows[0]).toEqual({ razao_social: 'Empresa Onboarding Teste Ltda', cnpj: '00000000000210' });

    const userRow = await adminPool.query('SELECT email, senha_hash FROM user_account WHERE id = $1', [resultado.userId]);
    expect(userRow.rows[0].email).toBe('admin-onboarding-210@example.com');
    expect(userRow.rows[0].senha_hash).not.toBeNull();

    const roleRow = await adminPool.query(
      `SELECT r.nome FROM role_assignment ra JOIN role r ON r.id = ra.role_id WHERE ra.user_id = $1`,
      [resultado.userId],
    );
    expect(roleRow.rows[0].nome).toBe('admin_tenant');
  });

  it('rejeita CNPJ já cadastrado por outro tenant', async () => {
    await expect(
      service.onboard({
        nomeEmpresa: 'Empresa Duplicada Ltda',
        cnpj: '00000000000210',
        emailAdmin: 'outro-admin@example.com',
        senhaAdmin: 'outra-senha-forte-123',
      }),
    ).rejects.toThrow();
  });
});

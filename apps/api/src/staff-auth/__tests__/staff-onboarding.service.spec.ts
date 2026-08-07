// apps/api/src/staff-auth/__tests__/staff-onboarding.service.spec.ts
import { ConflictException } from '@nestjs/common';
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
  let tenantIdCriadoConcorrencia: string | undefined;

  afterAll(async () => {
    for (const tenantId of [tenantIdCriado, tenantIdCriadoConcorrencia]) {
      if (!tenantId) continue;
      // role_assignment referencia user_account via FK -- precisa ser
      // apagado antes, senão o DELETE em user_account viola a constraint
      // role_assignment_user_id_fkey (desvio do exemplo original do brief).
      await adminPool.query('DELETE FROM role_assignment WHERE tenant_id = $1', [tenantId]);
      await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
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

  // Reproduz a corrida real (não o caminho do pre-check acima, que só pega o
  // caso sequencial): duas chamadas de onboard() com o MESMO CNPJ novo,
  // disparadas em paralelo via Promise.allSettled -- mesmo padrão de duas
  // conexões reais do pool usado em
  // src/insights/__tests__/adverse-impact-snapshot.service.spec.ts. Como
  // TenantContext.run() pega uma conexão nova do pool a cada chamada
  // (client = await pool.connect()), as duas transações rodam
  // genuinamente em paralelo: ambas podem passar pelo SELECT de pre-check
  // antes de qualquer uma commitar, e é o próprio Postgres que serializa a
  // segunda no INSERT -- ela bloqueia até a primeira commitar/dar rollback e
  // então recebe 23505 na tenant_cnpj_key. Isso é determinístico (a
  // serialização é garantida pelo índice único do Postgres, não por
  // timing do event loop), então não precisa de pausa artificial de query
  // como em staff-token.service.spec.ts.
  it('duas chamadas concorrentes com o MESMO CNPJ novo: exatamente uma cria o tenant, a outra recebe ConflictException (não o erro cru do pg)', async () => {
    const cnpjConcorrente = '00000000000236';

    const resultados = await Promise.allSettled([
      service.onboard({
        nomeEmpresa: 'Empresa Corrida A Ltda',
        cnpj: cnpjConcorrente,
        emailAdmin: 'corrida-a@example.com',
        senhaAdmin: 'senha-forte-corrida-123',
      }),
      service.onboard({
        nomeEmpresa: 'Empresa Corrida B Ltda',
        cnpj: cnpjConcorrente,
        emailAdmin: 'corrida-b@example.com',
        senhaAdmin: 'senha-forte-corrida-456',
      }),
    ]);

    const sucesso = resultados.filter(
      (r): r is PromiseFulfilledResult<{ tenantId: string; userId: string }> => r.status === 'fulfilled',
    );
    const falha = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(sucesso).toHaveLength(1);
    expect(falha).toHaveLength(1);

    // A rejeição precisa ser especificamente o ConflictException do
    // pre-check -- não o erro 23505 cru do pg vazando da transação.
    expect(falha[0].reason).toBeInstanceOf(ConflictException);
    expect((falha[0].reason as ConflictException).message).toBe('Este CNPJ já tem um tenant cadastrado');

    tenantIdCriadoConcorrencia = sucesso[0].value.tenantId;

    const tenantRows = await adminPool.query('SELECT id FROM tenant WHERE cnpj = $1', [cnpjConcorrente]);
    expect(tenantRows.rows).toHaveLength(1);
    expect(tenantRows.rows[0].id).toBe(tenantIdCriadoConcorrencia);
  });
});

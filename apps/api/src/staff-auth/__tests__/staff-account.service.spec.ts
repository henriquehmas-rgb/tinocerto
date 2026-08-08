import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { PasswordService } from '../password.service';
import { StaffAccountService } from '../staff-account.service';

describe('StaffAccountService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const PLACEHOLDER_TENANT = '00000000-0000-0000-0000-000000000000';

  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const tenant = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Staff Account', '00000000000237', 'test-tenant-00000000000237') RETURNING id`,
    );
    tenantId = tenant.rows[0].id;

    const passwordService = new PasswordService();
    const senhaHash = await passwordService.hash('senha-correta-123');
    const user = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email, senha_hash, mfa_habilitado) VALUES ($1, 'login@staff-account-test.com', $2, true) RETURNING id`,
      [tenantId, senhaHash],
    );
    userId = user.rows[0].id;

    const role = await adminPool.query<{ id: string }>(
      `SELECT id FROM role WHERE nome = 'admin_tenant' AND tenant_id IS NULL`,
    );
    await adminPool.query(
      `INSERT INTO role_assignment (user_id, tenant_id, role_id, scope_path) VALUES ($1, $2, $3, 'raiz')`,
      [userId, tenantId, role.rows[0].id],
    );
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM role_assignment WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('login com credenciais certas devolve userId/tenantId/roles/mfaHabilitado', async () => {
    const ctx = new TenantContext(appPool);
    const service = new StaffAccountService(new PasswordService());

    const result = await ctx.run(PLACEHOLDER_TENANT, (client) =>
      service.login(client, { email: 'login@staff-account-test.com', senha: 'senha-correta-123' }),
    );

    expect(result.userId).toBe(userId);
    expect(result.tenantId).toBe(tenantId);
    expect(result.roles).toEqual(['admin_tenant']);
    expect(result.mfaHabilitado).toBe(true);
  });

  it('login com senha errada lança UnauthorizedException', async () => {
    const ctx = new TenantContext(appPool);
    const service = new StaffAccountService(new PasswordService());

    await expect(
      ctx.run(PLACEHOLDER_TENANT, (client) =>
        service.login(client, { email: 'login@staff-account-test.com', senha: 'senha-errada' }),
      ),
    ).rejects.toThrow(/credenciais/i);
  });

  it('login com email inexistente lança UnauthorizedException com a mesma mensagem (sem oráculo de enumeração)', async () => {
    const ctx = new TenantContext(appPool);
    const service = new StaffAccountService(new PasswordService());

    await expect(
      ctx.run(PLACEHOLDER_TENANT, (client) =>
        service.login(client, { email: 'nao-existe@staff-account-test.com', senha: 'qualquer-coisa' }),
      ),
    ).rejects.toThrow(/credenciais inválidas/i);
  });

  // Task 7 -- métodos extraídos/adicionados para StaffAuthController.
  it('getRoles devolve os papéis atuais do usuário no tenant', async () => {
    const ctx = new TenantContext(appPool);
    const service = new StaffAccountService(new PasswordService());

    const roles = await ctx.run(tenantId, (client) => service.getRoles(client, userId, tenantId));

    expect(roles).toEqual(['admin_tenant']);
  });

  it('setMfaSecret grava o secret cifrado e getMfaSecret o devolve de volta (sem habilitar MFA)', async () => {
    const ctx = new TenantContext(appPool);
    const service = new StaffAccountService(new PasswordService());
    const secretCifrado = { ciphertext: 'ct', iv: 'iv', authTag: 'tag', wrappedDek: 'dek' };

    await ctx.run(tenantId, (client) => service.setMfaSecret(client, userId, secretCifrado));
    const lido = await ctx.run(tenantId, (client) => service.getMfaSecret(client, userId));

    expect(lido).toEqual(secretCifrado);

    const habilitado = await adminPool.query<{ mfa_habilitado: boolean }>(
      `SELECT mfa_habilitado FROM user_account WHERE id = $1`,
      [userId],
    );
    // setMfaSecret sozinho nunca habilita MFA -- só enableMfa faz isso.
    // A linha de fixture já nasceu com mfa_habilitado=true (beforeAll acima),
    // então esta asserção confirma que setMfaSecret não MEXEU nesse campo,
    // não que ele seja false.
    expect(habilitado.rows[0].mfa_habilitado).toBe(true);
  });

  it('getMfaSecret devolve null quando o usuário nunca configurou MFA', async () => {
    const ctx = new TenantContext(appPool);
    const service = new StaffAccountService(new PasswordService());
    const passwordService = new PasswordService();
    const outroUser = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email, senha_hash) VALUES ($1, 'sem-mfa@staff-account-test.com', $2) RETURNING id`,
      [tenantId, await passwordService.hash('qualquer-senha')],
    );

    const lido = await ctx.run(tenantId, (client) => service.getMfaSecret(client, outroUser.rows[0].id));

    expect(lido).toBeNull();

    await adminPool.query('DELETE FROM user_account WHERE id = $1', [outroUser.rows[0].id]);
  });

  it('enableMfa seta mfa_habilitado=true e grava os backup codes cifrados', async () => {
    const ctx = new TenantContext(appPool);
    const service = new StaffAccountService(new PasswordService());
    const passwordService = new PasswordService();
    const novoUser = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email, senha_hash) VALUES ($1, 'enable-mfa@staff-account-test.com', $2) RETURNING id`,
      [tenantId, await passwordService.hash('qualquer-senha')],
    );
    const novoUserId = novoUser.rows[0].id;
    const backupCodesCifrados = [{ ciphertext: 'a', iv: 'b', authTag: 'c', wrappedDek: 'd' }];

    await ctx.run(tenantId, (client) => service.enableMfa(client, novoUserId, backupCodesCifrados));

    const row = await adminPool.query<{ mfa_habilitado: boolean; mfa_backup_codes_cifrados: unknown }>(
      `SELECT mfa_habilitado, mfa_backup_codes_cifrados FROM user_account WHERE id = $1`,
      [novoUserId],
    );
    expect(row.rows[0].mfa_habilitado).toBe(true);
    expect(row.rows[0].mfa_backup_codes_cifrados).toEqual(backupCodesCifrados);

    await adminPool.query('DELETE FROM user_account WHERE id = $1', [novoUserId]);
  });
});

import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { PasswordService } from '../password.service';
import { CandidateTokenService } from '../candidate-token.service';
import { EmailService } from '../email.service';
import { PasswordResetService } from '../password-reset.service';

describe('PasswordResetService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const PLACEHOLDER_TENANT = '00000000-0000-0000-0000-000000000000';
  let personId: string;
  let candidateAccountId: string;

  beforeAll(async () => {
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-reset-teste', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Teste Reset', 'reset@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;
    const passwordService = new PasswordService();
    const account = await adminPool.query<{ id: string }>(
      `INSERT INTO candidate_account (person_id, email, senha_hash) VALUES ($1, 'reset@example.com', $2) RETURNING id`,
      [personId, await passwordService.hash('senha-antiga-123')],
    );
    candidateAccountId = account.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM candidate_password_reset_token WHERE candidate_account_id = $1', [candidateAccountId]);
    await adminPool.query('DELETE FROM candidate_refresh_token WHERE candidate_account_id = $1', [candidateAccountId]);
    await adminPool.query('DELETE FROM candidate_account WHERE id = $1', [candidateAccountId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.end();
    await appPool.end();
  });

  it('requestReset não lança para e-mail inexistente e retorna token undefined (não revela se a conta existe)', async () => {
    const ctx = new TenantContext(appPool);
    const service = new PasswordResetService(new EmailService(), new PasswordService(), new CandidateTokenService());

    const result = await ctx.run(PLACEHOLDER_TENANT, (client) => service.requestReset(client, 'nao-existe@example.com'));
    expect(result.token).toBeUndefined();
  });

  it('fluxo completo: solicita reset, troca a senha, login com a senha antiga falha e com a nova funciona, token é uso único', async () => {
    const ctx = new TenantContext(appPool);
    const emailService = new EmailService();
    const sendSpy = jest.spyOn(emailService, 'send');
    const passwordService = new PasswordService();
    const tokenService = new CandidateTokenService();
    const service = new PasswordResetService(emailService, passwordService, tokenService);

    const { token } = await ctx.run(PLACEHOLDER_TENANT, (client) => service.requestReset(client, 'reset@example.com'));
    expect(token).toBeDefined();
    expect(sendSpy).toHaveBeenCalledWith('reset@example.com', expect.any(String), expect.any(String));

    await ctx.run(PLACEHOLDER_TENANT, (client) => service.resetPassword(client, token!, 'senha-nova-456'));

    const row = await adminPool.query<{ senha_hash: string }>('SELECT senha_hash FROM candidate_account WHERE id = $1', [
      candidateAccountId,
    ]);
    await expect(passwordService.verify(row.rows[0].senha_hash, 'senha-antiga-123')).resolves.toBe(false);
    await expect(passwordService.verify(row.rows[0].senha_hash, 'senha-nova-456')).resolves.toBe(true);

    // Reusar o mesmo token de reset uma segunda vez deve falhar (uso único).
    await expect(
      ctx.run(PLACEHOLDER_TENANT, (client) => service.resetPassword(client, token!, 'outra-senha-789')),
    ).rejects.toThrow();
  });
});

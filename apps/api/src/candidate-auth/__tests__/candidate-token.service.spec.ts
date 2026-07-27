import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { CandidateTokenService } from '../candidate-token.service';

describe('CandidateTokenService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let personId: string;
  let candidateAccountId: string;

  beforeAll(async () => {
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-token-teste', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Teste Token', 'token@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;
    const account = await adminPool.query<{ id: string }>(
      `INSERT INTO candidate_account (person_id, email, senha_hash) VALUES ($1, 'token@example.com', 'hash-fake') RETURNING id`,
      [personId],
    );
    candidateAccountId = account.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM candidate_refresh_token WHERE candidate_account_id = $1', [candidateAccountId]);
    await adminPool.query('DELETE FROM candidate_account WHERE id = $1', [candidateAccountId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.end();
    await appPool.end();
  });

  it('emite um token e o rotaciona com sucesso', async () => {
    const ctx = new TenantContext(appPool);
    const service = new CandidateTokenService();

    const { token } = await ctx.run('00000000-0000-0000-0000-000000000000', (client) =>
      service.issue(client, candidateAccountId),
    );
    expect(token).toBeDefined();

    const rotated = await ctx.run('00000000-0000-0000-0000-000000000000', (client) => service.rotate(client, token));
    expect(rotated.candidateAccountId).toBe(candidateAccountId);
    expect(rotated.token).not.toBe(token);
  });

  it('rejeita rotacionar um token já usado (rotacionado antes) e revoga toda a conta', async () => {
    const ctx = new TenantContext(appPool);
    const service = new CandidateTokenService();

    const { token: original } = await ctx.run('00000000-0000-0000-0000-000000000000', (client) =>
      service.issue(client, candidateAccountId),
    );
    const { token: rotatedOnce } = await ctx.run('00000000-0000-0000-0000-000000000000', (client) =>
      service.rotate(client, original),
    );

    // Reapresentar o token ORIGINAL (já rotacionado uma vez) -- sinal de reuso/roubo.
    await expect(
      ctx.run('00000000-0000-0000-0000-000000000000', (client) => service.rotate(client, original)),
    ).rejects.toThrow();

    // A conta inteira deve estar revogada agora, incluindo o token que tinha rotacionado com sucesso.
    await expect(
      ctx.run('00000000-0000-0000-0000-000000000000', (client) => service.rotate(client, rotatedOnce)),
    ).rejects.toThrow();
  });

  it('rejeita um token que nunca existiu', async () => {
    const ctx = new TenantContext(appPool);
    const service = new CandidateTokenService();

    await expect(
      ctx.run('00000000-0000-0000-0000-000000000000', (client) => service.rotate(client, 'token-que-nao-existe')),
    ).rejects.toThrow();
  });
});

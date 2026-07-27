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

  it('fecha a corrida TOCTOU: duas apresentações concorrentes do MESMO token, com sobreposição forçada, produzem exatamente uma rotação bem-sucedida (regressão de segurança, round 1)', async () => {
    const ctx = new TenantContext(appPool);
    const service = new CandidateTokenService();

    const { token: original } = await ctx.run('00000000-0000-0000-0000-000000000000', (client) =>
      service.issue(client, candidateAccountId),
    );

    // Reproduz deterministicamente a janela de corrida original (duas
    // transações apresentando o MESMO token, ambas avançando a partir de um
    // estado "ainda não revogado") em vez de confiar no agendamento incidental
    // do event loop -- que, testado à parte, às vezes NÃO gera sobreposição
    // genuína (uma chamada termina, incluindo commit, antes da outra sequer
    // começar), o que faria este teste passar mesmo contra o código com bug.
    //
    // Para forçar a sobreposição de verdade: interceptamos o `client.query`
    // da lane "lenta" para pausá-la logo depois do SELECT inicial de
    // `rotate()` (que lê dados imutáveis -- id/expira_em -- e não decide mais
    // nada sozinho) e só deixá-la prosseguir para o UPDATE condicional depois
    // que a lane "rápida" já tiver rotacionado e commitado por completo. Se o
    // UPDATE condicional (`WHERE ... AND revogado_em IS NULL`) não fosse
    // atômico em relação a esse estado, a lane lenta ainda conseguiria
    // rotacionar com sucesso mesmo depois do commit da rápida -- exatamente o
    // bug original.
    let releaseSlowLane: () => void = () => {};
    const fastLaneCommitted = new Promise<void>((resolve) => {
      releaseSlowLane = resolve;
    });

    const slowLanePromise = ctx.run('00000000-0000-0000-0000-000000000000', async (client) => {
      const realQuery = client.query.bind(client);
      let pausedOnce = false;
      (client as unknown as { query: typeof client.query }).query = (async (...queryArgs: unknown[]) => {
        const first = queryArgs[0];
        const text = typeof first === 'string' ? first : (first as { text?: string })?.text;
        const result = await (realQuery as (...a: unknown[]) => Promise<unknown>)(...queryArgs);
        if (!pausedOnce && typeof text === 'string' && text.startsWith('SELECT id, candidate_account_id, expira_em FROM')) {
          pausedOnce = true;
          await fastLaneCommitted;
        }
        return result;
      }) as typeof client.query;

      try {
        return await service.rotate(client, original);
      } finally {
        (client as unknown as { query: typeof client.query }).query = realQuery as typeof client.query;
      }
    });

    // Dá à lane lenta a chance de rodar seu SELECT (e pausar) antes de
    // disparar a lane rápida -- torna a ordem de eventos explícita, embora a
    // lane rápida sempre vença de qualquer forma (ela nunca espera o gate).
    await new Promise((resolve) => setImmediate(resolve));

    const fastLaneResult = await ctx.run('00000000-0000-0000-0000-000000000000', (client) =>
      service.rotate(client, original),
    );
    releaseSlowLane();

    // A lane lenta -- que só decide o resultado depois que a rápida já
    // commitou a revogação do token original -- precisa ser rejeitada como
    // reuso, e não emitir um segundo token filho válido a partir do mesmo
    // token apresentado.
    await expect(slowLanePromise).rejects.toThrow();

    // A corrida detectada deve ter acionado revokeAll na conta inteira --
    // inclusive o novo token que a lane rápida acabou de emitir.
    await expect(
      ctx.run('00000000-0000-0000-0000-000000000000', (client) => service.rotate(client, fastLaneResult.token)),
    ).rejects.toThrow();
  });
});

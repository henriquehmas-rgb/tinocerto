import { Pool } from 'pg';
import Redis from 'ioredis';
import { CandidateApplicationSummaryConsumer } from '../candidate-application-summary.consumer';

describe('CandidateApplicationSummaryConsumer.handleEvent', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let personId: string;
  let tenantId: string;
  let jobId: string;
  const applicationId = '11111111-2222-3333-4444-555555555599';
  // [Desvio do plano, mesmo padrão de resume-parsing.consumer.spec.ts
  // (Task 13)] CandidateApplicationSummaryConsumer abre sua própria
  // conexão ioredis no construtor (não injetada) e este spec o instancia
  // diretamente, sem passar pelo ciclo de vida do Nest
  // (onModuleInit/onModuleDestroy nunca são chamados automaticamente
  // aqui). Sem fechar essa conexão explicitamente, o processo do Jest
  // fica pendurado indefinidamente após imprimir o resultado dos testes.
  let consumer: CandidateApplicationSummaryConsumer | undefined;

  beforeAll(async () => {
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-summary-consumer', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Teste Summary', 'summary@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;
    const tenant = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Summary', '00000000000043', 'empresa-summary-test') RETURNING id`,
    );
    tenantId = tenant.rows[0].id;
    // [Fix round 1, achado #2 do revisor independente] job_id real (via
    // org_unit -> requisition -> job), para exercitar a resolução de
    // job_titulo por subquery no consumer -- o payload real de
    // application.created traz job_id, nunca job_titulo (ver comentário em
    // ../candidate-application-summary.consumer.ts).
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Summary', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Summary Test', 'vaga-summary-test') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM candidate_application_summary WHERE person_id = $1', [personId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.end();
  });

  afterEach(async () => {
    await consumer?.onModuleDestroy();
    consumer = undefined;
  });

  it('cria a linha do índice em application.created (resolvendo job_titulo via job_id) e atualiza a etapa em application.stage_changed', async () => {
    consumer = new CandidateApplicationSummaryConsumer(adminPool);

    await consumer.handleEvent({
      eventType: 'application.created',
      tenantId,
      payload: { application_id: applicationId, person_id: personId, job_id: jobId },
    });

    let row = await adminPool.query(
      'SELECT etapa_funil, job_titulo FROM candidate_application_summary WHERE application_id = $1',
      [applicationId],
    );
    expect(row.rows[0].etapa_funil).toBe('triagem');
    expect(row.rows[0].job_titulo).toBe('Vaga Summary Test');

    await consumer.handleEvent({
      eventType: 'application.stage_changed',
      tenantId,
      payload: { application_id: applicationId, to_state: 'entrevista' },
    });

    row = await adminPool.query('SELECT etapa_funil FROM candidate_application_summary WHERE application_id = $1', [
      applicationId,
    ]);
    expect(row.rows[0].etapa_funil).toBe('entrevista');
  });

  it('marca reprovado_em em application.rejected', async () => {
    consumer = new CandidateApplicationSummaryConsumer(adminPool);

    await consumer.handleEvent({
      eventType: 'application.rejected',
      tenantId,
      payload: { application_id: applicationId },
    });

    const row = await adminPool.query('SELECT reprovado_em FROM candidate_application_summary WHERE application_id = $1', [
      applicationId,
    ]);
    expect(row.rows[0].reprovado_em).not.toBeNull();
  });

  describe('caminho real do Redis (processBatch, não handleEvent direto)', () => {
    // Achado CRITICAL de revisão adversarial: os dois testes acima chamam
    // handleEvent() diretamente, então nunca exercitam o parsing real de
    // uma mensagem do Redis Stream -- foi exatamente esse caminho
    // (processBatch) que tinha o bug: tratava o payload de domínio já
    // parseado como se fosse o envelope inteiro, lendo `.event_type`/
    // `.tenant_id`/`.payload` dele -- campos que nunca existem ali (são
    // irmãos de `payload`, não aninhados dentro dele -- ver
    // ../candidate-application-summary.consumer.ts e o commit de
    // referência 1d8816e, que corrigiu o mesmo bug em
    // insights/adverse-impact.consumer.ts). Por isso TODA mensagem real
    // era ACKed e descartada como "irrelevante" antes de chegar em
    // handleEvent, silenciosamente. Este bloco publica um evento via XADD
    // no MESMO FORMATO que OutboxPublisher.publishPending grava de
    // verdade (campos irmãos no nível superior) e chama processBatch
    // (método privado, acessado via cast -- é exatamente o método que o
    // laço real usa).
    const redis = new Redis(process.env.REDIS_URL!);
    const groupName = 'candidate_application_summary_consumer_group';
    const applicationIdReal = '11111111-2222-3333-4444-555555555598';

    afterAll(async () => {
      await redis.quit();
    });

    it('publica application.created via XADD (mesmo formato do OutboxPublisher) e processBatch cria a linha do índice', async () => {
      const streamKey = `outbox:${tenantId}`;
      try {
        await redis.xgroup('CREATE', streamKey, groupName, '0', 'MKSTREAM');
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
      }

      await redis.xadd(
        streamKey,
        '*',
        'id', '00000000-0000-0000-0000-000000000101',
        'aggregate_type', 'application',
        'aggregate_id', applicationIdReal,
        'event_type', 'application.created',
        'sequence', '1',
        'payload', JSON.stringify({ application_id: applicationIdReal, person_id: personId, job_id: jobId }),
        'occurred_at', new Date().toISOString(),
      );

      consumer = new CandidateApplicationSummaryConsumer(adminPool);
      // processBatch é privado -- acessado via cast de propósito, é o
      // método real que o laço de consumo chama, não uma reimplementação
      // paralela do teste.
      await (consumer as unknown as { processBatch: (t: string, id: '0' | '>') => Promise<void> }).processBatch(
        tenantId,
        '>',
      );

      const row = await adminPool.query(
        'SELECT etapa_funil, job_titulo FROM candidate_application_summary WHERE application_id = $1',
        [applicationIdReal],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].etapa_funil).toBe('triagem');
      expect(row.rows[0].job_titulo).toBe('Vaga Summary Test');

      // Controle: a mensagem foi ACKed (não fica pendente pra sempre).
      const pendentes = await redis.xpending(streamKey, groupName);
      expect(Number((pendentes as unknown[])[0])).toBe(0);
    });

    it('mensagem de evento IRRELEVANTE (fora de RELEVANT_EVENT_TYPES) é ACKed e ignorada, não processada', async () => {
      const streamKey = `outbox:${tenantId}`;

      await redis.xadd(
        streamKey,
        '*',
        'id', '00000000-0000-0000-0000-000000000102',
        'aggregate_type', 'application',
        'aggregate_id', applicationIdReal,
        'event_type', 'application.first_response_sent', // fora de RELEVANT_EVENT_TYPES
        'sequence', '2',
        'payload', JSON.stringify({ application_id: applicationIdReal }),
        'occurred_at', new Date().toISOString(),
      );

      consumer = new CandidateApplicationSummaryConsumer(adminPool);
      await (consumer as unknown as { processBatch: (t: string, id: '0' | '>') => Promise<void> }).processBatch(
        tenantId,
        '>',
      );

      const pendentes = await redis.xpending(streamKey, groupName);
      expect(Number((pendentes as unknown[])[0])).toBe(0); // ACKed, não preso como pendente
    });
  });
});

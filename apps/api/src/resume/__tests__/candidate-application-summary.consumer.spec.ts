import { Pool } from 'pg';
import { CandidateApplicationSummaryConsumer } from '../candidate-application-summary.consumer';

describe('CandidateApplicationSummaryConsumer.handleEvent', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let personId: string;
  let tenantId: string;
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
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM candidate_application_summary WHERE person_id = $1', [personId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.end();
  });

  afterEach(async () => {
    await consumer?.onModuleDestroy();
    consumer = undefined;
  });

  it('cria a linha do índice em application.created e atualiza a etapa em application.stage_changed', async () => {
    consumer = new CandidateApplicationSummaryConsumer(adminPool);

    await consumer.handleEvent({
      eventType: 'application.created',
      tenantId,
      payload: { application_id: applicationId, person_id: personId, job_titulo: 'Vaga Summary Test' },
    });

    let row = await adminPool.query('SELECT etapa_funil FROM candidate_application_summary WHERE application_id = $1', [
      applicationId,
    ]);
    expect(row.rows[0].etapa_funil).toBe('triagem');

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
});

import { Pool } from 'pg';
import { CandidateApplicationController } from '../candidate-application.controller';

describe('CandidateApplicationController', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let personId: string;

  beforeAll(async () => {
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-candidate-app-ctrl', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Teste Ctrl', 'ctrl@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;
    // [Achado do gate consolidado da Fase 1b, Task 18] candidate_application_summary
    // não tem mais tenant_id (ver resume_0005__candidate_application_summary_drop_tenant_id.sql)
    // -- não precisa mais de um tenant de fixture aqui.
    await adminPool.query(
      `INSERT INTO candidate_application_summary (person_id, application_id, job_titulo, etapa_funil)
       VALUES ($1, '22222222-3333-4444-5555-666666666699', 'Vaga Ctrl Test', 'entrevista')`,
      [personId],
    );
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM candidate_application_summary WHERE person_id = $1', [personId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.end();
  });

  it('lista as candidaturas do candidato autenticado, ordenadas pela mais recente', async () => {
    const controller = new CandidateApplicationController(adminPool);

    const result = await controller.listMyApplications({ personId } as any);

    expect(result).toHaveLength(1);
    expect(result[0].jobTitulo).toBe('Vaga Ctrl Test');
    expect(result[0].etapaFunil).toBe('entrevista');
  });
});

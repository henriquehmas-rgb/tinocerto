import { Pool } from 'pg';

describe('resume_upload — schema', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let personId: string;
  let resumeUploadId: string;

  afterAll(async () => {
    if (resumeUploadId) await adminPool.query('DELETE FROM resume_upload WHERE id = $1', [resumeUploadId]);
    if (personId) await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.end();
  });

  it('aceita status pendente/processado/falhou e rejeita qualquer outro valor', async () => {
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-resume-schema', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Teste Resume', 'resume@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;

    const inserted = await adminPool.query<{ id: string }>(
      `INSERT INTO resume_upload (person_id, storage_key) VALUES ($1, 'chave-teste.pdf') RETURNING id`,
      [personId],
    );
    resumeUploadId = inserted.rows[0].id;

    await expect(
      adminPool.query(`INSERT INTO resume_upload (person_id, storage_key, status) VALUES ($1, 'outra-chave.pdf', 'invalido')`, [
        personId,
      ]),
    ).rejects.toThrow();
  });
});

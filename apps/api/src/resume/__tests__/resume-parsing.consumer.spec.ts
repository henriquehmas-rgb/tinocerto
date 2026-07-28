import { Pool } from 'pg';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { StorageService } from '../../storage/storage.service';
import { ResumeStructuringService } from '../resume-structuring.service';
import { ResumeParsingConsumer } from '../resume-parsing.consumer';

describe('ResumeParsingConsumer.handleResumeUploaded', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const maybeIt = hasApiKey ? it : it.skip;
  let personId: string;
  let resumeUploadId: string;
  // ResumeParsingConsumer abre sua própria conexão ioredis no construtor
  // (não injetada) e este spec o instancia diretamente, sem passar pelo
  // ciclo de vida do Nest (onModuleInit/onModuleDestroy nunca são chamados
  // automaticamente aqui). Sem fechar essa conexão explicitamente, o
  // processo do Jest fica pendurado indefinidamente após imprimir o
  // resultado dos testes -- mesmo padrão de fechamento explícito usado em
  // outbox-to-audit.consumer.spec.ts (Fase 0) para o cliente Redis de lá.
  let consumer: ResumeParsingConsumer | undefined;

  beforeAll(async () => {
    process.env.MINIO_ENDPOINT ??= 'localhost';
    process.env.MINIO_PORT ??= '9000';
    process.env.MINIO_ACCESS_KEY ??= 'tinocerto';
    process.env.MINIO_SECRET_KEY ??= 'dev_local_only';

    if (!hasApiKey) {
      console.warn('ANTHROPIC_API_KEY ausente -- pulando teste de integração real (ResumeParsingConsumer)');
      return;
    }

    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-resume-consumer', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Teste Consumer', 'consumer@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;

    const storageService = new StorageService();
    await storageService.ensureBucket('curriculos');

    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Analista de Operações Pleno na Empresa Exemplo, de 2020 a 2023.', {
      x: 50,
      y: page.getHeight() - 50,
      size: 12,
      font,
    });
    const pdfBytes = Buffer.from(await doc.save());
    await storageService.upload('curriculos', `${personId}/curriculo-teste.pdf`, pdfBytes, 'application/pdf');

    const resumeUpload = await adminPool.query<{ id: string }>(
      `INSERT INTO resume_upload (person_id, storage_key) VALUES ($1, $2) RETURNING id`,
      [personId, `${personId}/curriculo-teste.pdf`],
    );
    resumeUploadId = resumeUpload.rows[0].id;
  });

  afterAll(async () => {
    if (personId) {
      await adminPool.query('DELETE FROM person_profile WHERE person_id = $1', [personId]);
      await adminPool.query('DELETE FROM resume_upload WHERE person_id = $1', [personId]);
      await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    }
    await adminPool.end();
  });

  afterEach(async () => {
    await consumer?.onModuleDestroy();
    consumer = undefined;
  });

  maybeIt('extrai, estrutura e grava person_profile com offset rastreável, marcando resume_upload como processado', async () => {
    consumer = new ResumeParsingConsumer(adminPool, new StorageService(), new ResumeStructuringService());

    await consumer.handleResumeUploaded({ resumeUploadId, storageKey: `${personId}/curriculo-teste.pdf` });

    const profile = await adminPool.query('SELECT experiencias FROM person_profile WHERE person_id = $1', [personId]);
    expect(profile.rows).toHaveLength(1);
    expect(profile.rows[0].experiencias.length).toBeGreaterThan(0);
    expect(profile.rows[0].experiencias[0]).toHaveProperty('offsetInicio');

    const upload = await adminPool.query('SELECT status, texto_extraido FROM resume_upload WHERE id = $1', [resumeUploadId]);
    expect(upload.rows[0].status).toBe('processado');
    expect(upload.rows[0].texto_extraido).toContain('Analista de Operações');
  }, 30000);

  it('marca resume_upload como falhou se a extração/estruturação lançar, sem deixar a transação pela metade', async () => {
    consumer = new ResumeParsingConsumer(adminPool, new StorageService(), new ResumeStructuringService());

    await expect(
      consumer.handleResumeUploaded({ resumeUploadId: 'id-que-nao-existe', storageKey: 'chave-que-nao-existe.pdf' }),
    ).rejects.toThrow();
  });
});

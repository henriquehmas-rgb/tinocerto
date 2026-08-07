import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { StorageService } from '../../storage/storage.service';
import { CandidateTouchpointService } from '../../hiring/candidate-touchpoint.service';
import { ApplicationService } from '../../hiring/application.service';
import { ApplicationCustomFieldResponseService } from '../../hiring/application-custom-field-response.service';
import { EnvelopeEncryptionService } from '../../talent/envelope-encryption.service';
import { OutboxService } from '../../outbox/outbox.service';
import { PublicApplicationService } from '../public-application.service';

function buildService() {
  return new PublicApplicationService(
    new CandidateTouchpointService(),
    new ApplicationService(new OutboxService()),
    new StorageService(),
    new OutboxService(),
    new ApplicationCustomFieldResponseService(),
    new EnvelopeEncryptionService(),
  );
}

describe('PublicApplicationService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let jobId: string;
  let inscricaoFieldId: string;
  let personId: string;

  beforeAll(async () => {
    process.env.MINIO_ENDPOINT ??= 'localhost';
    process.env.MINIO_PORT ??= '9000';
    process.env.MINIO_ACCESS_KEY ??= 'tinocerto';
    process.env.MINIO_SECRET_KEY ??= 'dev_local_only';
    process.env.ENVELOPE_ENCRYPTION_KEK ??= Buffer.alloc(32, 7).toString('base64');

    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Public App', '00000000000042', 'empresa-public-app-test') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Public App', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, publicado_em, canais)
       VALUES ($1, $2, 'Vaga Public App', 'vaga-public-app-test', now(), '{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;
    const field = await adminPool.query<{ id: string }>(
      `INSERT INTO job_custom_field (tenant_id, job_id, label, fase_coleta) VALUES ($1, $2, 'Pretensão salarial', 'inscricao') RETURNING id`,
      [tenantId, jobId],
    );
    inscricaoFieldId = field.rows[0].id;
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-public-app', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Candidato Public App', 'publicapp@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application_custom_field_response WHERE tenant_id = $1', [tenantId]);
    // [Desvio do plano, Fase 1b Task 14] PublicApplicationService.apply()
    // passou a gravar em candidate_application_summary (Step 7 da Task
    // 14) -- sem apagar essa linha antes de apagar person, o DELETE FROM
    // person abaixo quebra a FK candidate_application_summary_person_id_fkey
    // (reproduzido ao vivo rodando a suíte completa após a Task 14).
    await adminPool.query('DELETE FROM candidate_application_summary WHERE person_id = $1', [personId]);
    await adminPool.query('DELETE FROM resume_upload WHERE person_id = $1', [personId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM candidate_touchpoint WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job_custom_field WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('cria touchpoint, application, resposta de campo de inscrição, resume_upload e evento resume.uploaded', async () => {
    const ctx = new TenantContext(appPool);
    await new StorageService().ensureBucket('curriculos');
    const service = buildService();

    const { applicationId } = await ctx.run(tenantId, (client) =>
      service.apply(client, {
        tenantId,
        jobId,
        personId,
        curriculo: { buffer: Buffer.from('%PDF-1.4\nconteúdo fake de pdf'), originalname: 'curriculo.pdf', mimetype: 'application/pdf' },
        respostasInscricao: [{ jobCustomFieldId: inscricaoFieldId, valor: 'R$ 5.000' }],
      }),
    );

    expect(applicationId).toBeDefined();

    const application = await adminPool.query('SELECT * FROM application WHERE id = $1', [applicationId]);
    expect(application.rows).toHaveLength(1);

    const response = await adminPool.query('SELECT * FROM application_custom_field_response WHERE application_id = $1', [
      applicationId,
    ]);
    expect(response.rows).toHaveLength(1);

    const resumeUpload = await adminPool.query('SELECT * FROM resume_upload WHERE person_id = $1', [personId]);
    expect(resumeUpload.rows).toHaveLength(1);
    expect(resumeUpload.rows[0].status).toBe('pendente');

    const event = await adminPool.query(
      `SELECT payload FROM outbox_event WHERE event_type = 'resume.uploaded' AND tenant_id = $1`,
      [tenantId],
    );
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0].payload.resume_upload_id).toBe(resumeUpload.rows[0].id);
  });

  it('rejeita upload que não seja PDF', async () => {
    const ctx = new TenantContext(appPool);
    const service = buildService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.apply(client, {
          tenantId,
          jobId,
          personId,
          curriculo: { buffer: Buffer.from('não é pdf'), originalname: 'curriculo.docx', mimetype: 'application/msword' },
          respostasInscricao: [],
        }),
      ),
    ).rejects.toThrow(/PDF/);
  });

  // Achado da revisão consolidada: mimetype vem do Content-Type que o
  // cliente controla livremente na parte multipart -- um cliente malicioso
  // pode alegar 'application/pdf' num arquivo que não é PDF de verdade.
  it('rejeita upload com mimetype forjado como PDF mas sem os magic bytes de um PDF real', async () => {
    const ctx = new TenantContext(appPool);
    const service = buildService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.apply(client, {
          tenantId,
          jobId,
          personId,
          curriculo: {
            buffer: Buffer.from('isto não começa com a assinatura de um PDF'),
            originalname: 'curriculo.pdf',
            mimetype: 'application/pdf',
          },
          respostasInscricao: [],
        }),
      ),
    ).rejects.toThrow(/PDF/);
  });
});

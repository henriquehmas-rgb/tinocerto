import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { EnvelopeEncryptionService } from '../../talent/envelope-encryption.service';
import { PersonService } from '../../talent/person.service';
import { OutboxService } from '../../outbox/outbox.service';
import { JobCustomFieldService } from '../job-custom-field.service';
import { CandidateTouchpointService } from '../candidate-touchpoint.service';
import { ApplicationService } from '../application.service';
import { DecisionService } from '../decision.service';
import { ApplicationCustomFieldResponseService } from '../application-custom-field-response.service';

describe('ApplicationCustomFieldResponseService — coleta faseada', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const encryption = new EnvelopeEncryptionService();
  let tenantId: string;
  let jobId: string;
  let inscricaoFieldId: string;
  let admissaoFieldId: string;
  let userId: string;

  beforeAll(async () => {
    process.env.ENVELOPE_ENCRYPTION_KEK ??= 'a'.repeat(64);
    process.env.CPF_HASH_PEPPER ??= 'pepper-de-teste';

    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Coleta Faseada', '00000000000027') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const user = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador.cf@empresa.com') RETURNING id`,
      [tenantId],
    );
    userId = user.rows[0].id;
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req CF', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, canais) VALUES ($1, $2, 'Vaga CF', 'vaga-cf-fase', '{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;

    const ctx = new TenantContext(appPool);
    const customFieldService = new JobCustomFieldService();
    const inscricaoField = await ctx.run(tenantId, (client) =>
      customFieldService.addField(client, { tenantId, jobId, label: 'Anos de experiência', faseColeta: 'inscricao' }),
    );
    inscricaoFieldId = inscricaoField.id;
    const admissaoField = await ctx.run(tenantId, (client) =>
      customFieldService.addField(client, { tenantId, jobId, label: 'Endereço completo', faseColeta: 'admissao' }),
    );
    admissaoFieldId = admissaoField.id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM application_custom_field_response WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM decision WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM candidate_touchpoint WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job_custom_field WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person WHERE cpf_hash IN (SELECT cpf_hash FROM person)', []);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  async function createApplication(cpf: string) {
    const ctx = new TenantContext(appPool);
    const personService = new PersonService(encryption);
    const touchpointService = new CandidateTouchpointService();
    const applicationService = new ApplicationService(new OutboxService());

    const person = await ctx.run(tenantId, (client) =>
      personService.create(client, { nome: 'Candidato CF', emailPrincipal: `cf-${cpf}@teste.com`, cpf }),
    );
    const touchpoint = await ctx.run(tenantId, (client) =>
      touchpointService.record(client, { tenantId, personId: person.id, canal: 'site_carreiras' }),
    );
    const application = await ctx.run(tenantId, (client) =>
      applicationService.create(client, { tenantId, jobId, personId: person.id, touchpointId: touchpoint.id }),
    );
    return application.id;
  }

  it('bloqueia resposta de campo de admissão antes da aprovação', async () => {
    const applicationId = await createApplication('11111111111');
    const ctx = new TenantContext(appPool);
    const service = new ApplicationCustomFieldResponseService();

    await expect(
      ctx.run(tenantId, (client) =>
        service.recordResponse(client, encryption, {
          tenantId,
          applicationId,
          jobCustomFieldId: admissaoFieldId,
          valor: 'Rua Teste, 123',
        }),
      ),
    ).rejects.toThrow(/admissão/);
  });

  it('permite resposta de campo de inscrição a qualquer momento', async () => {
    const applicationId = await createApplication('22222222222');
    const ctx = new TenantContext(appPool);
    const service = new ApplicationCustomFieldResponseService();

    const { id } = await ctx.run(tenantId, (client) =>
      service.recordResponse(client, encryption, {
        tenantId,
        applicationId,
        jobCustomFieldId: inscricaoFieldId,
        valor: '5 anos',
      }),
    );
    expect(id).toBeDefined();
  });

  it('permite resposta de campo de admissão após decisão de aprovação', async () => {
    const applicationId = await createApplication('33333333333');
    const ctx = new TenantContext(appPool);
    const decisionService = new DecisionService(new OutboxService());
    await ctx.run(tenantId, (client) =>
      decisionService.record(client, { tenantId, applicationId, tipo: 'aprovacao', decidoPor: userId }),
    );

    const service = new ApplicationCustomFieldResponseService();
    const { id } = await ctx.run(tenantId, (client) =>
      service.recordResponse(client, encryption, {
        tenantId,
        applicationId,
        jobCustomFieldId: admissaoFieldId,
        valor: 'Rua Aprovada, 456',
      }),
    );
    expect(id).toBeDefined();
  });
});

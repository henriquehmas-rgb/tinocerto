import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { OutboxService } from '../../outbox/outbox.service';
import { DecisionService } from '../decision.service';
import { OfferService } from '../offer.service';
import { ApplicationStartedWorkService, InicioTrabalhoJaRegistradoError, NenhumaOfertaAceitaError } from '../application-started-work.service';

describe('ApplicationStartedWorkService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const offerService = new OfferService(new OutboxService(), new DecisionService(new OutboxService()));
  const startedWorkService = new ApplicationStartedWorkService(new OutboxService());

  let tenantId: string;
  let applicationId: string;
  let recrutadorId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Started Work Ltda','00000000000124','test-tenant-00000000000124') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Started Work', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Started Work', 'vaga-started-work-test') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-started-work','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato Started Work','started-work@example.com') RETURNING id`,
    );
    const application = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, job.rows[0].id, person.rows[0].id],
    );
    applicationId = application.rows[0].id;
    const recrutador = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador-sw@example.com') RETURNING id`,
      [tenantId],
    );
    recrutadorId = recrutador.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM application_started_work WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM offer WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM decision WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-started-work'`);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('registrar sem oferta aceita rejeita com NenhumaOfertaAceitaError', async () => {
    await expect(
      tenantContext.run(tenantId, (client) =>
        startedWorkService.registrar(client, { tenantId, applicationId, startDate: '2026-09-01', registradoPor: recrutadorId }),
      ),
    ).rejects.toBeInstanceOf(NenhumaOfertaAceitaError);
  });

  it('registrar depois de uma oferta aceita grava o marco e o evento candidate.started_work', async () => {
    const { id: offerId } = await tenantContext.run(tenantId, (client) =>
      offerService.extend(client, { tenantId, applicationId, valor: '7000.00', estendidoPor: recrutadorId }),
    );
    await tenantContext.run(tenantId, (client) => offerService.accept(client, { tenantId, offerId, respondidoPor: recrutadorId }));

    const { id } = await tenantContext.run(tenantId, (client) =>
      startedWorkService.registrar(client, { tenantId, applicationId, startDate: '2026-09-01', registradoPor: recrutadorId }),
    );
    expect(id).toBeTruthy();

    const row = await adminPool.query(`SELECT offer_id, data_inicio FROM application_started_work WHERE id = $1`, [id]);
    expect(row.rows[0].offer_id).toBe(offerId);

    const outboxRows = await adminPool.query<{ payload: { start_date: string } }>(
      `SELECT payload FROM outbox_event WHERE tenant_id = $1 AND aggregate_id = $2 AND event_type = 'candidate.started_work'`,
      [tenantId, applicationId],
    );
    expect(outboxRows.rows).toHaveLength(1);
    expect(outboxRows.rows[0].payload.start_date).toBe('2026-09-01');
  });

  it('registrar duas vezes para a mesma candidatura rejeita com InicioTrabalhoJaRegistradoError na segunda', async () => {
    await expect(
      tenantContext.run(tenantId, (client) =>
        startedWorkService.registrar(client, { tenantId, applicationId, startDate: '2026-09-02', registradoPor: recrutadorId }),
      ),
    ).rejects.toBeInstanceOf(InicioTrabalhoJaRegistradoError);
  });
});

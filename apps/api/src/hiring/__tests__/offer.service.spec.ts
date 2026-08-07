import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { OutboxService } from '../../outbox/outbox.service';
import { DecisionService } from '../decision.service';
import { OfferService, OfertaJaRespondidaError, OfertaNaoEncontradaError, OfertaPendenteExistenteError } from '../offer.service';

describe('OfferService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const offerService = new OfferService(new OutboxService(), new DecisionService(new OutboxService()));

  let tenantId: string;
  let applicationId: string;
  let recrutadorId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Offer Ltda','00000000000120','test-tenant-00000000000120') RETURNING id`,
    );
    tenantId = t.rows[0].id;

    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Offer', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Offer', 'vaga-offer-test') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-offer-svc','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato Offer','offer-svc@example.com') RETURNING id`,
    );
    const application = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, job.rows[0].id, person.rows[0].id],
    );
    applicationId = application.rows[0].id;
    const recrutador = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador-offer@example.com') RETURNING id`,
      [tenantId],
    );
    recrutadorId = recrutador.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM offer WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM decision WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-offer-svc'`);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('extend cria oferta estendida, journals decision(tipo=oferta), e grava offer.extended no outbox', async () => {
    const { id: offerId } = await tenantContext.run(tenantId, (client) =>
      offerService.extend(client, { tenantId, applicationId, valor: '8500.00', estendidoPor: recrutadorId }),
    );
    expect(offerId).toBeTruthy();

    const decisionRows = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT tipo FROM decision WHERE tenant_id = $1 AND application_id = $2 AND tipo = 'oferta'`, [tenantId, applicationId]),
    );
    expect(decisionRows.rows).toHaveLength(1);

    const outboxRows = await tenantContext.run(tenantId, (client) =>
      client.query<{ event_type: string; payload: { offer_id: string; valor: string } }>(
        `SELECT event_type, payload FROM outbox_event WHERE tenant_id = $1 AND aggregate_id = $2 AND event_type = 'offer.extended'`,
        [tenantId, applicationId],
      ),
    );
    expect(outboxRows.rows).toHaveLength(1);
    expect(outboxRows.rows[0].payload.offer_id).toBe(offerId);
    expect(outboxRows.rows[0].payload.valor).toBe('8500.00');

    // Limpa para não colidir com o próximo teste (uma oferta pendente por candidatura).
    await adminPool.query(`UPDATE offer SET status = 'recusada', respondido_por = $1, respondido_em = now() WHERE id = $2`, [
      recrutadorId,
      offerId,
    ]);
  });

  it('extend numa candidatura que já tem oferta pendente rejeita com OfertaPendenteExistenteError', async () => {
    const primeira = await tenantContext.run(tenantId, (client) =>
      offerService.extend(client, { tenantId, applicationId, valor: '9000.00', estendidoPor: recrutadorId }),
    );

    await expect(
      tenantContext.run(tenantId, (client) =>
        offerService.extend(client, { tenantId, applicationId, valor: '9500.00', estendidoPor: recrutadorId }),
      ),
    ).rejects.toBeInstanceOf(OfertaPendenteExistenteError);

    await adminPool.query(`UPDATE offer SET status = 'recusada', respondido_por = $1, respondido_em = now() WHERE id = $2`, [
      recrutadorId,
      primeira.id,
    ]);
  });

  it('accept muda status para aceita e grava offer.accepted', async () => {
    const { id: offerId } = await tenantContext.run(tenantId, (client) =>
      offerService.extend(client, { tenantId, applicationId, valor: '10000.00', estendidoPor: recrutadorId }),
    );

    await tenantContext.run(tenantId, (client) => offerService.accept(client, { tenantId, offerId, respondidoPor: recrutadorId }));

    const row = await adminPool.query<{ status: string }>(`SELECT status FROM offer WHERE id = $1`, [offerId]);
    expect(row.rows[0].status).toBe('aceita');

    const outboxRows = await adminPool.query(`SELECT event_type FROM outbox_event WHERE tenant_id = $1 AND event_type = 'offer.accepted'`, [
      tenantId,
    ]);
    expect(outboxRows.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('accept numa oferta já respondida rejeita com OfertaJaRespondidaError', async () => {
    const { id: offerId } = await tenantContext.run(tenantId, (client) =>
      offerService.extend(client, { tenantId, applicationId, valor: '11000.00', estendidoPor: recrutadorId }),
    );
    await tenantContext.run(tenantId, (client) => offerService.decline(client, { tenantId, offerId, respondidoPor: recrutadorId }));

    await expect(
      tenantContext.run(tenantId, (client) => offerService.accept(client, { tenantId, offerId, respondidoPor: recrutadorId })),
    ).rejects.toBeInstanceOf(OfertaJaRespondidaError);
  });

  it('accept numa oferta inexistente rejeita com OfertaNaoEncontradaError', async () => {
    await expect(
      tenantContext.run(tenantId, (client) =>
        offerService.accept(client, { tenantId, offerId: '00000000-0000-0000-0000-000000000000', respondidoPor: recrutadorId }),
      ),
    ).rejects.toBeInstanceOf(OfertaNaoEncontradaError);
  });

  it('decline grava motivo_recusa_codigo no payload de offer.declined', async () => {
    const { id: offerId } = await tenantContext.run(tenantId, (client) =>
      offerService.extend(client, { tenantId, applicationId, valor: '12000.00', estendidoPor: recrutadorId }),
    );
    await tenantContext.run(tenantId, (client) =>
      offerService.decline(client, { tenantId, offerId, respondidoPor: recrutadorId, motivoRecusaCodigo: 'aceitou_outra_proposta' }),
    );

    const outboxRows = await adminPool.query<{ payload: { motivo_codigo: string } }>(
      `SELECT payload FROM outbox_event WHERE tenant_id = $1 AND aggregate_id = $2 AND event_type = 'offer.declined' ORDER BY sequence DESC LIMIT 1`,
      [tenantId, applicationId],
    );
    expect(outboxRows.rows[0].payload.motivo_codigo).toBe('aceitou_outra_proposta');
  });
});

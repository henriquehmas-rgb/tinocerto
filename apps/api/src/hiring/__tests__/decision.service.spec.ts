import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { DecisionService, DecisaoNaoEncontradaError, RevisaoJaSolicitadaError } from '../decision.service';
import { OutboxService } from '../../outbox/outbox.service';

describe('DecisionService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let applicationId: string;
  let userId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Decision', '00000000000023', 'test-tenant-00000000000023') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const user = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email, status) VALUES ($1, 'recrutador@example.com', 'ativo') RETURNING id`,
      [tenantId],
    );
    userId = user.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Decision', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, publicado_em, canais)
       VALUES ($1, $2, 'Vaga Decision', 'vaga-decision-test', now(), '{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-decision', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Decision Teste', 'decision@example.com')
       RETURNING id`,
    );
    const application = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, job.rows[0].id, person.rows[0].id],
    );
    applicationId = application.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM decision WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person WHERE nome = $1', ['Decision Teste']);
    await adminPool.query('DELETE FROM user_account WHERE id = $1', [userId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('registra uma reprovação com revisao_solicitada e grava application.rejected', async () => {
    const ctx = new TenantContext(appPool);
    const service = new DecisionService(new OutboxService());

    const { id } = await ctx.run(tenantId, (client) =>
      service.record(client, {
        tenantId,
        applicationId,
        tipo: 'reprovacao',
        motivoCodigo: 'perfil_nao_aderente',
        decidoPor: userId,
      }),
    );

    const row = await adminPool.query('SELECT tipo, revisao_solicitada, decidido_por FROM decision WHERE id = $1', [id]);
    expect(row.rows[0].tipo).toBe('reprovacao');
    expect(row.rows[0].revisao_solicitada).toBe(false);
    expect(row.rows[0].decidido_por).toBe(userId);

    const events = await adminPool.query(
      `SELECT payload FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'application.rejected'`,
      [applicationId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload.reason_code).toBe('perfil_nao_aderente');
    // review_requestable sempre true nesta fase -- não há decisão
    // automatizada ainda, então toda reprovação é elegível a revisão
    // (02-requisitos-e-compliance.md §3.4: botão em TODA tela de
    // reprovação, não só nas automatizadas -- a distinção só importa
    // quando existir decisão automatizada de verdade).
    expect(events.rows[0].payload.review_requestable).toBe(true);
  });

  it('rejeita gravar decisão sem decidido_por (constraint NOT NULL)', async () => {
    const ctx = new TenantContext(appPool);
    const service = new DecisionService(new OutboxService());

    await expect(
      ctx.run(tenantId, (client) =>
        service.record(client, {
          tenantId,
          applicationId,
          tipo: 'reprovacao',
          decidoPor: undefined as unknown as string,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('DecisionService -- solicitarRevisao / listarRevisoesPendentes (Fase 3d)', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const ctx = new TenantContext(appPool);
  const service = new DecisionService(new OutboxService());

  let tenantId: string;
  let applicationId: string;
  let userId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Revisao', '00000000000126', 'test-tenant-00000000000126') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const user = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email, status) VALUES ($1, 'recrutador-revisao@example.com', 'ativo') RETURNING id`,
      [tenantId],
    );
    userId = user.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Revisao', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, publicado_em, canais)
       VALUES ($1, $2, 'Vaga Revisao', 'vaga-revisao-test', now(), '{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-revisao', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Revisao Teste', 'revisao@example.com')
       RETURNING id`,
    );
    const application = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, job.rows[0].id, person.rows[0].id],
    );
    applicationId = application.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM decision WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person WHERE nome = $1', ['Revisao Teste']);
    await adminPool.query('DELETE FROM user_account WHERE id = $1', [userId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('record(tipo: reprovacao) seguido de solicitarRevisao() marca revisao_solicitada e preenche revisao_solicitada_em', async () => {
    const { id: decisionId } = await ctx.run(tenantId, (client) =>
      service.record(client, { tenantId, applicationId, tipo: 'reprovacao', motivoCodigo: 'perfil_nao_aderente', decidoPor: userId }),
    );

    await ctx.run(tenantId, (client) => service.solicitarRevisao(client, tenantId, decisionId));

    const row = await adminPool.query<{ revisao_solicitada: boolean; revisao_solicitada_em: string | null }>(
      `SELECT revisao_solicitada, revisao_solicitada_em FROM decision WHERE id = $1`,
      [decisionId],
    );
    expect(row.rows[0].revisao_solicitada).toBe(true);
    expect(row.rows[0].revisao_solicitada_em).not.toBeNull();
  });

  it('solicitarRevisao() numa decisão já revisada rejeita com RevisaoJaSolicitadaError', async () => {
    const { id: decisionId } = await ctx.run(tenantId, (client) =>
      service.record(client, { tenantId, applicationId, tipo: 'reprovacao', motivoCodigo: 'perfil_nao_aderente', decidoPor: userId }),
    );
    await ctx.run(tenantId, (client) => service.solicitarRevisao(client, tenantId, decisionId));

    await expect(ctx.run(tenantId, (client) => service.solicitarRevisao(client, tenantId, decisionId))).rejects.toBeInstanceOf(
      RevisaoJaSolicitadaError,
    );
  });

  it('solicitarRevisao() numa decisão tipo = oferta rejeita com DecisaoNaoEncontradaError -- escopo é estritamente reprovação', async () => {
    const { id: decisionId } = await ctx.run(tenantId, (client) =>
      service.record(client, { tenantId, applicationId, tipo: 'oferta', decidoPor: userId }),
    );

    await expect(ctx.run(tenantId, (client) => service.solicitarRevisao(client, tenantId, decisionId))).rejects.toBeInstanceOf(
      DecisaoNaoEncontradaError,
    );
  });

  it('solicitarRevisao() num decisionId inexistente rejeita com DecisaoNaoEncontradaError', async () => {
    await expect(
      ctx.run(tenantId, (client) => service.solicitarRevisao(client, tenantId, '00000000-0000-0000-0000-000000000000')),
    ).rejects.toBeInstanceOf(DecisaoNaoEncontradaError);
  });

  it('listarRevisoesPendentes() devolve só decisões com revisao_solicitada = true, ordenadas, e nunca inclui tipo = oferta', async () => {
    const revisoes = await ctx.run(tenantId, (client) => service.listarRevisoesPendentes(client, tenantId));

    expect(revisoes.length).toBeGreaterThan(0);
    for (const revisao of revisoes) {
      expect(revisao.tipo).toBe('reprovacao');
    }
    const timestamps = revisoes.map((r) => r.revisaoSolicitadaEm).filter((t): t is string => t !== null);
    const sorted = [...timestamps].sort();
    expect(timestamps).toEqual(sorted);
  });
});

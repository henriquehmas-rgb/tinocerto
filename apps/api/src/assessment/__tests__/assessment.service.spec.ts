import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { EnvelopeEncryptionService } from '../../talent/envelope-encryption.service';
import { OutboxService } from '../../outbox/outbox.service';
import { AssessmentService } from '../assessment.service';

const VERSION_ID = 'a55e55e0-0000-4000-8000-000000000002';

describe('AssessmentService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  let tenantId: string;
  let applicationId: string;
  let personId: string;
  let encryption: EnvelopeEncryptionService;

  const service = () => new AssessmentService(new OutboxService());

  beforeAll(async () => {
    process.env.ENVELOPE_ENCRYPTION_KEK ??= Buffer.alloc(32, 7).toString('base64');
    encryption = new EnvelopeEncryptionService();

    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug)
       VALUES ('Empresa Assess Svc','00000000000051','test-tenant-00000000000051') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1,'empresa','Matriz','matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1,$2,'Req Svc','aprovada',now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, canais) VALUES ($1,$2,'Vaga Svc','vaga-assess-svc','{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-assess-svc','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Assess Svc','assesssvc@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;
    const app = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantId, job.rows[0].id, personId],
    );
    applicationId = app.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query(
      'DELETE FROM item_response WHERE assessment_application_id IN (SELECT id FROM assessment_application WHERE tenant_id = $1)',
      [tenantId],
    );
    await adminPool.query('DELETE FROM assessment_result WHERE person_id = $1', [personId]);
    await adminPool.query('DELETE FROM assessment_application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  async function blocosDoInstrumento(): Promise<{ blockId: string; itemIds: string[] }[]> {
    const { rows } = await adminPool.query<{ block_id: string; item_ids: string[] }>(
      `SELECT b.id AS block_id, array_agg(bi.item_id ORDER BY bi.posicao) AS item_ids
         FROM block b JOIN block_item bi ON bi.block_id = b.id
        WHERE b.instrument_version_id = $1
        GROUP BY b.id ORDER BY min(b.ordem)`,
      [VERSION_ID],
    );
    return rows.map((r) => ({ blockId: r.block_id, itemIds: r.item_ids }));
  }

  it('convidar grava assessment.invited e nasce em status convidado', async () => {
    const ctx = new TenantContext(appPool);
    const { id } = await ctx.run(tenantId, (client) =>
      service().convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );

    const row = await adminPool.query<{ status: string }>(
      'SELECT status FROM assessment_application WHERE id = $1',
      [id],
    );
    expect(row.rows[0].status).toBe('convidado');

    const ev = await adminPool.query(
      `SELECT 1 FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'assessment.invited'`,
      [id],
    );
    expect(ev.rows).toHaveLength(1);
  });

  it('fluxo completo: inicia, responde todos os blocos, conclui e grava theta das 5 dimensões', async () => {
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));

    const blocos = await blocosDoInstrumento();
    for (const bloco of blocos) {
      await ctx.run(tenantId, (client) =>
        svc.responderBloco(client, encryption, {
          assessmentApplicationId: id,
          blockId: bloco.blockId,
          itemIds: bloco.itemIds,
          maisId: bloco.itemIds[0],
          menosId: bloco.itemIds[1],
        }),
      );
    }

    const inicio = Date.now();
    const resultado = await ctx.run(tenantId, (client) => svc.concluir(client, encryption, id));
    const decorrido = Date.now() - inicio;

    // SLO do roadmap: theta/se disponíveis em < 2s após a última resposta.
    expect(decorrido).toBeLessThan(2000);

    expect(Object.keys(resultado.theta).sort()).toEqual(
      ['abertura', 'amabilidade', 'conscienciosidade', 'estabilidade', 'extroversao'],
    );
    for (const dimensao of Object.keys(resultado.theta)) {
      expect(Number.isFinite(resultado.theta[dimensao])).toBe(true);
      expect(resultado.seTheta[dimensao]).toBeGreaterThan(0);
    }

    const status = await adminPool.query<{ status: string }>(
      'SELECT status FROM assessment_application WHERE id = $1',
      [id],
    );
    expect(status.rows[0].status).toBe('concluido');

    const ev = await adminPool.query(
      `SELECT event_type FROM outbox_event WHERE aggregate_id = $1 ORDER BY sequence`,
      [id],
    );
    expect(ev.rows.map((r) => r.event_type)).toEqual([
      'assessment.invited',
      'assessment.started',
      'assessment.completed',
    ]);
  });

  it('a resposta bruta fica criptografada — o payload em claro não aparece na coluna', async () => {
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));

    const [bloco] = await blocosDoInstrumento();
    await ctx.run(tenantId, (client) =>
      svc.responderBloco(client, encryption, {
        assessmentApplicationId: id,
        blockId: bloco.blockId,
        itemIds: bloco.itemIds,
        maisId: bloco.itemIds[0],
        menosId: bloco.itemIds[1],
      }),
    );

    const row = await adminPool.query<{ resposta_criptografada: unknown }>(
      'SELECT resposta_criptografada FROM item_response WHERE assessment_application_id = $1',
      [id],
    );
    const bruto = JSON.stringify(row.rows[0].resposta_criptografada);
    // O id do item escolhido não pode aparecer em claro no payload gravado.
    expect(bruto).not.toContain(bloco.itemIds[0]);
    expect(bruto).toContain('ciphertext');
  });

  it('rejeita responder o mesmo bloco duas vezes', async () => {
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));
    const [bloco] = await blocosDoInstrumento();

    const responder = () =>
      ctx.run(tenantId, (client) =>
        svc.responderBloco(client, encryption, {
          assessmentApplicationId: id,
          blockId: bloco.blockId,
          itemIds: bloco.itemIds,
          maisId: bloco.itemIds[0],
          menosId: bloco.itemIds[1],
        }),
      );

    await responder();
    await expect(responder()).rejects.toMatchObject({ code: '23505' });
  });

  it('rejeita bloco em que mais e menos são o mesmo item', async () => {
    const ctx = new TenantContext(appPool);
    const svc = service();

    const { id } = await ctx.run(tenantId, (client) =>
      svc.convidar(client, { tenantId, applicationId, personId, instrumentVersionId: VERSION_ID }),
    );
    await ctx.run(tenantId, (client) => svc.iniciar(client, id));
    const [bloco] = await blocosDoInstrumento();

    await expect(
      ctx.run(tenantId, (client) =>
        svc.responderBloco(client, encryption, {
          assessmentApplicationId: id,
          blockId: bloco.blockId,
          itemIds: bloco.itemIds,
          maisId: bloco.itemIds[0],
          menosId: bloco.itemIds[0],
        }),
      ),
    ).rejects.toThrow(/mesmo item/i);
  });
});

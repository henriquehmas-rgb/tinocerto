import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { ApplicationService } from '../application.service';
import { OutboxService } from '../../outbox/outbox.service';

describe('ApplicationService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let jobId: string;
  let personId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Application', '00000000000035', 'test-tenant-00000000000035') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req App', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, publicado_em, canais)
       VALUES ($1, $2, 'Vaga Application', 'vaga-application-test', now(), '{}') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-application', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Fernanda Costa', 'fernanda.costa@example.com')
       RETURNING id`,
    );
    personId = person.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('cria uma candidatura em etapa "triagem" e grava application.created', async () => {
    const ctx = new TenantContext(appPool);
    const service = new ApplicationService(new OutboxService());

    const { id } = await ctx.run(tenantId, (client) =>
      service.create(client, { tenantId, jobId, personId }),
    );

    const row = await adminPool.query('SELECT etapa_funil FROM application WHERE id = $1', [id]);
    expect(row.rows[0].etapa_funil).toBe('triagem');

    const events = await adminPool.query(
      `SELECT payload FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'application.created'`,
      [id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload.person_id).toBe(personId);
  });

  it('findByIdWithPersonView projeta só nome/email — nunca cpf_hash/cpf_encriptado', async () => {
    const ctx = new TenantContext(appPool);
    const service = new ApplicationService(new OutboxService());

    const { id } = await ctx.run(tenantId, (client) =>
      service.create(client, { tenantId, jobId, personId }),
    );

    const view = await ctx.run(tenantId, (client) => service.findByIdWithPersonView(client, id));

    expect(view).not.toBeNull();
    expect(view!.person.nome).toBe('Fernanda Costa');
    expect(view!.person.emailPrincipal).toBe('fernanda.costa@example.com');
    expect(view!.person).not.toHaveProperty('cpfHash');
    expect(view!.person).not.toHaveProperty('cpfEncriptado');
    expect(JSON.stringify(view)).not.toContain('ciphertext');
  });
});

describe('ApplicationService.listByCursor', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const applicationService = new ApplicationService(new OutboxService());

  let tenantId: string;
  let jobId: string;
  const applicationIds: string[] = [];

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Cursor Ltda','00000000000147','test-tenant-00000000000147') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo) VALUES ($1, $2, 'Req Cursor') RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Cursor', 'vaga-cursor-147') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;

    for (let i = 0; i < 5; i++) {
      const person = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ($1, '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', $2, $3) RETURNING id`,
        [`hash-cursor-147-${i}`, `Candidato ${i}`, `cursor147-${i}@example.com`],
      );
      const app = await adminPool.query<{ id: string }>(
        `INSERT INTO application (tenant_id, job_id, person_id, criado_em) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, jobId, person.rows[0].id, new Date(Date.UTC(2026, 7, 1, 12, 0, i))],
      );
      applicationIds.push(app.rows[0].id);
    }
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query(`DELETE FROM person WHERE cpf_hash LIKE 'hash-cursor-147-%'`);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('pagina 2 a 2 sem repetir nem pular, em ordem de criado_em crescente', async () => {
    const pagina1 = await tenantContext.run(tenantId, (client) => applicationService.listByCursor(client, { limit: 2 }));
    expect(pagina1.items.map((i) => i.id)).toEqual([applicationIds[0], applicationIds[1]]);
    expect(pagina1.hasMore).toBe(true);

    const cursor1 = { sortValue: pagina1.items[1].createdAt.toISOString(), id: pagina1.items[1].id };
    const pagina2 = await tenantContext.run(tenantId, (client) => applicationService.listByCursor(client, { limit: 2, cursor: cursor1 }));
    expect(pagina2.items.map((i) => i.id)).toEqual([applicationIds[2], applicationIds[3]]);
    expect(pagina2.hasMore).toBe(true);

    const cursor2 = { sortValue: pagina2.items[1].createdAt.toISOString(), id: pagina2.items[1].id };
    const pagina3 = await tenantContext.run(tenantId, (client) => applicationService.listByCursor(client, { limit: 2, cursor: cursor2 }));
    expect(pagina3.items.map((i) => i.id)).toEqual([applicationIds[4]]);
    expect(pagina3.hasMore).toBe(false);
  });

  it('filtra por jobId e por stage', async () => {
    // Desvio do plano: o plano original filtrava por stage: 'triagem', mas
    // 'triagem' é o próprio DEFAULT de application.etapa_funil
    // (hiring_0004__application.sql) -- as 5 candidaturas do fixture acima
    // NUNCA sobrescrevem essa coluna no INSERT, então TODAS já nascem em
    // 'triagem'. Filtrar por 'triagem' devolveria as 5 linhas, não zero --
    // o teste original não provaria que o filtro de fato restringe nada.
    // Troca para 'entrevista' (mesmo valor usado em
    // pipeline-stage-transition.service.spec.ts/application.controller.spec.ts
    // para o mesmo propósito), que genuinamente não bate com nenhuma linha
    // do fixture.
    const semResultado = await tenantContext.run(tenantId, (client) => applicationService.listByCursor(client, { jobId, stage: 'entrevista', limit: 10 }));
    expect(semResultado.items).toEqual([]);

    const todosDoJob = await tenantContext.run(tenantId, (client) => applicationService.listByCursor(client, { jobId, limit: 10 }));
    expect(todosDoJob.items).toHaveLength(5);
  });

  it('isolamento de tenant: outro tenant não enxerga nenhuma linha', async () => {
    const outro = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Cursor Outro Ltda','00000000000148','test-tenant-00000000000148') RETURNING id`,
    );
    try {
      const resultado = await tenantContext.run(outro.rows[0].id, (client) => applicationService.listByCursor(client, { limit: 10 }));
      expect(resultado.items).toEqual([]);
    } finally {
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [outro.rows[0].id]);
    }
  });
});

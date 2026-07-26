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
      `INSERT INTO tenant (razao_social, cnpj) VALUES ('Empresa Application', '00000000000035') RETURNING id`,
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

import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AdverseImpactSnapshotService } from '../adverse-impact-snapshot.service';

describe('AdverseImpactSnapshotService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let jobId: string;
  const personIds: string[] = [];

  // Viés conhecido injetado: 10 candidaturas "feminino" (2 alcançam
  // 'entrevista'), 10 "masculino" (8 alcançam 'entrevista'). taxa_fem =
  // 0.2, taxa_masc = 0.8 -- razão = 0.2/0.8 = 0.25, bem abaixo de 0.8.
  async function criarCandidato(genero: string, alcancaEntrevista: boolean): Promise<void> {
    const p = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ($1, '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Candidato', $2)
       RETURNING id`,
      [`hash-snapshot-${Math.random()}`, `snapshot-${Math.random()}@example.com`],
    );
    const personId = p.rows[0].id;
    personIds.push(personId);

    const consent = await adminPool.query<{ id: string }>(
      `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'autodeclaracao_diversidade', 'consentimento') RETURNING id`,
      [personId, tenantId],
    );
    await adminPool.query(
      `INSERT INTO demographic_self_report (tenant_id, person_id, genero, consent_id) VALUES ($1, $2, $3, $4)`,
      [tenantId, personId, genero, consent.rows[0].id],
    );

    const app = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, jobId, personId],
    );
    if (alcancaEntrevista) {
      await adminPool.query(
        `INSERT INTO pipeline_stage_transition (application_id, tenant_id, from_state, to_state, actor_id, actor_type)
         VALUES ($1, $2, 'triagem', 'entrevista', $3, 'user')`,
        [app.rows[0].id, tenantId, personId],
      );
    }
  }

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Snapshot', '00000000000067', 'test-tenant-00000000000067') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Snapshot', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Snapshot', 'vaga-snapshot') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;

    for (let i = 0; i < 10; i++) await criarCandidato('feminino', i < 2);
    for (let i = 0; i < 10; i++) await criarCandidato('masculino', i < 8);
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM adverse_impact_snapshot WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM pipeline_stage_transition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM demographic_self_report WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM consent WHERE person_id = ANY($1)', [personIds]);
    await adminPool.query('DELETE FROM person WHERE id = ANY($1)', [personIds]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('detecta o viés injetado: razão de gênero na etapa entrevista fica abaixo de 0.8', async () => {
    const ctx = new TenantContext(appPool);
    const service = new AdverseImpactSnapshotService();

    await ctx.run(tenantId, (client) => service.recompute(client, tenantId, jobId));

    const linhas = await adminPool.query<{
      etapa: string;
      grupo_demografico: string;
      taxa_selecao: string;
      razao_4_5: string;
    }>('SELECT etapa, grupo_demografico, taxa_selecao, razao_4_5 FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2', [
      tenantId,
      jobId,
    ]);

    const feminino = linhas.rows.find((r) => r.etapa === 'entrevista' && r.grupo_demografico === 'genero:feminino');
    const masculino = linhas.rows.find((r) => r.etapa === 'entrevista' && r.grupo_demografico === 'genero:masculino');

    expect(Number(feminino!.taxa_selecao)).toBeCloseTo(0.2, 2);
    expect(Number(masculino!.taxa_selecao)).toBeCloseTo(0.8, 2);
    expect(Number(feminino!.razao_4_5)).toBeCloseTo(0.25, 2);
    expect(Number(feminino!.razao_4_5)).toBeLessThan(0.8);
    expect(Number(masculino!.razao_4_5)).toBe(1);
  });

  it('a etapa triagem tem todo mundo que se candidatou (baseline implícito, sem transição gravada)', async () => {
    const ctx = new TenantContext(appPool);
    const service = new AdverseImpactSnapshotService();

    await ctx.run(tenantId, (client) => service.recompute(client, tenantId, jobId));

    const triagem = await adminPool.query<{ grupo_demografico: string; taxa_selecao: string }>(
      `SELECT grupo_demografico, taxa_selecao FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2 AND etapa = 'triagem'`,
      [tenantId, jobId],
    );
    const feminino = triagem.rows.find((r) => r.grupo_demografico === 'genero:feminino');
    expect(Number(feminino!.taxa_selecao)).toBe(1);
  });

  it('recompute é idempotente: rodar duas vezes não duplica linhas', async () => {
    const ctx = new TenantContext(appPool);
    const service = new AdverseImpactSnapshotService();

    await ctx.run(tenantId, (client) => service.recompute(client, tenantId, jobId));
    await ctx.run(tenantId, (client) => service.recompute(client, tenantId, jobId));

    const total = await adminPool.query('SELECT count(*) FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2', [
      tenantId,
      jobId,
    ]);
    // 2 etapas (triagem, entrevista) x 2 categorias de gênero = 4 linhas,
    // não 8 -- prova que é upsert, não insert duplicado.
    expect(Number(total.rows[0].count)).toBe(4);
  });

  it('listarPorVaga devolve as linhas já calculadas, ordenadas', async () => {
    const ctx = new TenantContext(appPool);
    const service = new AdverseImpactSnapshotService();

    await ctx.run(tenantId, (client) => service.recompute(client, tenantId, jobId));
    const linhas = await ctx.run(tenantId, (client) => service.listarPorVaga(client, jobId));

    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.every((l) => 'etapa' in l && 'grupoDemografico' in l && 'razao4Quintos' in l)).toBe(true);
  });
});

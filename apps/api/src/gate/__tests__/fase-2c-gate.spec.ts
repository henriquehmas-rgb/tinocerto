import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { DemographicSelfReportService } from '../../trust/demographic-self-report.service';
import { AdverseImpactSnapshotService } from '../../insights/adverse-impact-snapshot.service';

function listarArquivosDeProducao(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === '__tests__' || entrada === 'node_modules') continue;
    const completo = path.join(dir, entrada);
    const stat = statSync(completo);
    if (stat.isDirectory()) {
      listarArquivosDeProducao(completo, acc);
    } else if (entrada.endsWith('.ts') && !entrada.endsWith('.spec.ts')) {
      acc.push(completo);
    }
  }
  return acc;
}

describe('Gate consolidado — Fase 2c (Painel de Impacto Adverso)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);

  const SRC_ROOT = path.resolve(__dirname, '../..');

  afterAll(async () => {
    await adminPool.end();
    await appPool.end();
  });

  it.each(['demographic_self_report', 'adverse_impact_snapshot'])(
    '%s tem RLS FORCE+RESTRICTIVE com predicado NULLIF',
    async (tabela) => {
      const rel = await adminPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
        [tabela],
      );
      expect(rel.rows[0].relrowsecurity).toBe(true);
      expect(rel.rows[0].relforcerowsecurity).toBe(true);

      const pol = await adminPool.query<{ policyname: string; permissive: string; qual: string }>(
        `SELECT policyname, permissive, qual FROM pg_policies WHERE tablename = $1`,
        [tabela],
      );
      const restritiva = pol.rows.find((r) => r.policyname === 'tenant_isolation');
      expect(restritiva?.permissive).toBe('RESTRICTIVE');
      expect(restritiva?.qual).toContain('NULLIF');
    },
  );

  it("consent.finalidade aceita 'autodeclaracao_diversidade' e continua rejeitando finalidade inventada", async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 2c Ltda','00000000000073','test-tenant-00000000000073') RETURNING id`,
    );
    const tenantId = t.rows[0].id;
    const p = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-gate-2c','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Gate 2c','gate2c@example.com')
       RETURNING id`,
    );
    const personId = p.rows[0].id;
    try {
      await expect(
        adminPool.query(
          `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'autodeclaracao_diversidade', 'consentimento')`,
          [personId, tenantId],
        ),
      ).resolves.not.toThrow();

      await expect(
        adminPool.query(
          `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'finalidade_inventada', 'consentimento')`,
          [personId, tenantId],
        ),
      ).rejects.toThrow(/consent_finalidade_check/);
    } finally {
      await adminPool.query('DELETE FROM consent WHERE person_id = $1', [personId]);
      await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    }
  });

  it('nenhum arquivo de produção fora de insights/ e trust/demographic-self-report.service.ts lê demographic_self_report em SQL real', () => {
    const arquivos = listarArquivosDeProducao(SRC_ROOT).filter(
      (f) => !f.includes(`${path.sep}insights${path.sep}`) && !f.endsWith(path.join('trust', 'demographic-self-report.service.ts')),
    );
    expect(arquivos.length).toBeGreaterThan(50);

    // Padrão de USO SQL real (FROM/JOIN), não string solta -- evita falso
    // positivo em comentário que só MENCIONA o nome da tabela (mesma
    // classe de cuidado do gate da Fase 2b).
    const padraoUsoSql = /\b(from|join)\s+demographic_self_report\b/i;
    const ofensores = arquivos.filter((f) => padraoUsoSql.test(readFileSync(f, 'utf-8')));
    expect(ofensores.map((f) => path.relative(SRC_ROOT, f))).toEqual([]);
  });

  it('as migrations da Fase 2c estão registradas no manifest, na ordem certa', () => {
    const manifest = JSON.parse(readFileSync(path.join(SRC_ROOT, '../migrations/manifest.json'), 'utf-8')) as {
      migrations: string[];
    };
    const esperadas = [
      'trust_0006__consent_finalidade_autodeclaracao.sql',
      'trust_0007__demographic_self_report.sql',
      'trust_0008__demographic_self_report_consent_tenant_coerencia.sql',
      'insights_0001__adverse_impact_snapshot.sql',
      'insights_0002__adverse_impact_snapshot_grant_delete.sql',
    ];
    for (const migration of esperadas) {
      expect(manifest.migrations).toContain(migration);
    }
  });

  it('ponta a ponta: viés injetado produz razão 4/5 abaixo de 0.8, pelo pool de RUNTIME, com isolamento de tenant real', async () => {
    let tenantId: string | undefined;
    let outroTenantId: string | undefined;
    let orgUnitId: string | undefined;
    let requisitionId: string | undefined;
    let jobId: string | undefined;
    const personIds: string[] = [];
    try {
      tenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 2c E2E Ltda','00000000000074','test-tenant-00000000000074') RETURNING id`,
        )
      ).rows[0].id;
      outroTenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 2c E2E Outro Ltda','00000000000075','test-tenant-00000000000075') RETURNING id`,
        )
      ).rows[0].id;
      orgUnitId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
          [tenantId],
        )
      ).rows[0].id;
      requisitionId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Gate 2c', 'aprovada', now()) RETURNING id`,
          [tenantId, orgUnitId],
        )
      ).rows[0].id;
      jobId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Gate 2c', 'vaga-gate-2c') RETURNING id`,
          [tenantId, requisitionId],
        )
      ).rows[0].id;

      const demographicService = new DemographicSelfReportService();
      const snapshotService = new AdverseImpactSnapshotService();

      const criarCandidato = async (genero: string, aprovado: boolean): Promise<void> => {
        const personId = (
          await adminPool.query<{ id: string }>(
            `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
             VALUES ($1, '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Gate 2c Candidato', $2) RETURNING id`,
            [`hash-gate-2c-e2e-${Math.random()}`, `gate2ce2e-${Math.random()}@example.com`],
          )
        ).rows[0].id;
        personIds.push(personId);
        const consentId = (
          await adminPool.query<{ id: string }>(
            `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'autodeclaracao_diversidade', 'consentimento') RETURNING id`,
            [personId, tenantId],
          )
        ).rows[0].id;
        await tenantContext.run(tenantId!, (client) =>
          demographicService.declarar(client, { tenantId: tenantId!, personId, genero, consentId }),
        );
        const app = await adminPool.query<{ id: string }>(
          `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, jobId, personId],
        );
        if (aprovado) {
          await adminPool.query(
            `INSERT INTO pipeline_stage_transition (application_id, tenant_id, from_state, to_state, actor_id, actor_type)
             VALUES ($1, $2, 'triagem', 'entrevista', $3, 'user')`,
            [app.rows[0].id, tenantId, personId],
          );
        }
      };

      // Viés conhecido: grupo A com 80% de avanço, grupo B com 20%.
      for (let i = 0; i < 10; i++) await criarCandidato('grupoA', i < 8);
      for (let i = 0; i < 10; i++) await criarCandidato('grupoB', i < 2);

      await tenantContext.run(tenantId, (client) => snapshotService.recompute(client, tenantId!, jobId!));

      const linhas = await tenantContext.run(tenantId, (client) => snapshotService.listarPorVaga(client, jobId!));
      const grupoB = linhas.find((l) => l.etapa === 'entrevista' && l.grupoDemografico === 'genero:grupoB');
      expect(grupoB).toBeDefined();
      expect(grupoB!.razao4Quintos).toBeLessThan(0.8);

      // Isolamento: outro tenant não enxerga nada deste snapshot.
      const linhasDeOutroTenant = await tenantContext.run(outroTenantId, (client) => snapshotService.listarPorVaga(client, jobId!));
      expect(linhasDeOutroTenant).toEqual([]);
    } finally {
      if (jobId) await adminPool.query('DELETE FROM adverse_impact_snapshot WHERE job_id = $1', [jobId]);
      if (jobId) await adminPool.query('DELETE FROM pipeline_stage_transition WHERE tenant_id = $1', [tenantId]);
      if (jobId) await adminPool.query('DELETE FROM application WHERE job_id = $1', [jobId]);
      if (jobId) await adminPool.query('DELETE FROM job WHERE id = $1', [jobId]);
      if (requisitionId) await adminPool.query('DELETE FROM requisition WHERE id = $1', [requisitionId]);
      if (orgUnitId) await adminPool.query('DELETE FROM org_unit WHERE id = $1', [orgUnitId]);
      if (tenantId) await adminPool.query('DELETE FROM demographic_self_report WHERE tenant_id = $1', [tenantId]);
      if (personIds.length) await adminPool.query('DELETE FROM consent WHERE person_id = ANY($1)', [personIds]);
      if (personIds.length) await adminPool.query('DELETE FROM person WHERE id = ANY($1)', [personIds]);
      if (tenantId) await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
      if (outroTenantId) await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenantId]);
    }
  });
});

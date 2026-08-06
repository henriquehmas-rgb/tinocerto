import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AdherenceService, QUERY_ADERENCIA_POR_CANDIDATURA } from '../../matching/adherence.service';
import { PersonService, QUERY_HABILIDADES_POR_PESSOA } from '../../talent/person.service';
import { EnvelopeEncryptionService } from '../../talent/envelope-encryption.service';

// Lista todo arquivo .ts de produção (não __tests__) sob src/, exceto o
// próprio talent/person.service.ts -- é o único lugar autorizado a
// mencionar person_profile. Caminhada manual (não glob) para não
// depender de dependência nova.
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

describe('Gate consolidado — Fase 2b (Score de Aderência)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Pool de RUNTIME (app_runtime): é o papel sujeito a RLS. O papel de admin
  // é rolbypassrls, então ler/escrever pelo adminPool derrotaria o gate.
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

  it('job mantém RLS FORCE+RESTRICTIVE com predicado NULLIF depois do ALTER que adicionou habilidades_exigidas', async () => {
    const rel = await adminPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'job'`,
    );
    expect(rel.rows[0].relrowsecurity).toBe(true);
    expect(rel.rows[0].relforcerowsecurity).toBe(true);

    const pol = await adminPool.query<{ policyname: string; permissive: string; qual: string }>(
      `SELECT policyname, permissive, qual FROM pg_policies WHERE tablename = 'job'`,
    );
    const restritiva = pol.rows.find((r) => r.policyname === 'tenant_isolation');
    expect(restritiva?.permissive).toBe('RESTRICTIVE');
    expect(restritiva?.qual).toContain('NULLIF');
  });

  it('job.habilidades_exigidas existe, é text[] e nasce vazia por padrão', async () => {
    // ÂNCORA DE EXISTÊNCIA antes da asserção sobre o tipo -- mesma disciplina
    // do gate da Fase 2a: zero linhas também é o que uma coluna renomeada ou
    // removida devolveria.
    const { rows } = await adminPool.query<{ data_type: string; column_default: string | null }>(
      `SELECT data_type, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'job' AND column_name = 'habilidades_exigidas'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('ARRAY');
    expect(rows[0].column_default).toContain("'{}'");
  });

  it('nenhuma tabela de RESULTADO de aderência foi criada -- o score é computado sob demanda, decisão de escopo da Fase 2b', async () => {
    const { rows } = await adminPool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND (table_name ILIKE '%aderenc%' OR table_name ILIKE '%adherence%')`,
    );
    expect(rows).toEqual([]);
  });

  it('nenhuma tabela nova do domínio Matching usa pgvector -- recall por embedding é deliberadamente fora de escopo', async () => {
    const ext = await adminPool.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    expect(ext.rows).toEqual([]);
  });

  it('a migration hiring_0014 (habilidades_exigidas) está registrada no manifest', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(SRC_ROOT, '../migrations/manifest.json'), 'utf-8'),
    ) as { migrations: string[] };
    expect(manifest.migrations).toContain('hiring_0014__job_habilidades_exigidas.sql');
  });

  it('NENHUM arquivo de produção fora de talent/person.service.ts menciona person_profile -- único ponto de leitura/escrita do sistema', () => {
    // Achado de revisão adversarial (Task 3, corrigido em 27fdad5): a
    // primeira versão de AdherenceService lia person_profile via SQL direto.
    // Este gate torna a correção durável -- sobrevive mesmo que alguém
    // refatore adherence.service.ts sem reler o design.
    const arquivos = listarArquivosDeProducao(SRC_ROOT).filter(
      (f) => !f.endsWith(path.join('talent', 'person.service.ts')) && !f.endsWith(path.join('resume', 'resume-parsing.consumer.ts')),
    );
    // resume-parsing.consumer.ts é a ÚNICA outra exceção legítima: é quem
    // ESCREVE person_profile pela primeira vez (Fase 1a), não um leitor novo
    // do domínio Matching. Ver comentário de talent/person.service.ts.
    expect(arquivos.length).toBeGreaterThan(50); // âncora de existência: a varredura não pode estar vazia

    // Procura o padrão de USO SQL real (FROM/JOIN person_profile), não a
    // string solta -- adherence.service.ts legitimamente MENCIONA
    // "person_profile" em comentário, explicando que a leitura foi movida
    // para PersonService. Um scan por string solta pegaria esse comentário
    // como falso positivo (mesma classe de erro que "idade" dentro de
    // "habilidades" -- ver adherence.service.spec.ts).
    const padraoUsoSql = /\b(from|join)\s+person_profile\b/i;
    const ofensores = arquivos.filter((f) => padraoUsoSql.test(readFileSync(f, 'utf-8')));
    expect(ofensores.map((f) => path.relative(SRC_ROOT, f))).toEqual([]);
  });

  it('allowlist estrutural das duas queries sensíveis da Fase 2b -- subconjunto bidirecional, não blocklist', () => {
    function colunasDoSelect(query: string): Set<string> {
      const clause = query.match(/SELECT([\s\S]*?)FROM/i)?.[1] ?? '';
      return new Set(
        clause
          .split(/[\s,]+/)
          .map((token) => token.replace(/^[a-z]+\./i, '').toLowerCase())
          .filter(Boolean),
      );
    }

    const colunasAderencia = colunasDoSelect(QUERY_ADERENCIA_POR_CANDIDATURA);
    expect([...colunasAderencia].sort()).toEqual(['habilidades_exigidas', 'person_id']);

    const colunasHabilidades = colunasDoSelect(QUERY_HABILIDADES_POR_PESSOA);
    expect([...colunasHabilidades].sort()).toEqual(['habilidades']);
  });

  it('ponta a ponta pelo pool de RUNTIME: score de aderência calculado corretamente, e invisível para outro tenant via RLS', async () => {
    let tenantA: string | undefined;
    let tenantB: string | undefined;
    let orgUnitId: string | undefined;
    let requisitionId: string | undefined;
    let jobId: string | undefined;
    let personId: string | undefined;
    let applicationId: string | undefined;
    try {
      tenantA = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug)
           VALUES ('Gate 2b Ltda','00000000000064','test-tenant-00000000000064') RETURNING id`,
        )
      ).rows[0].id;
      tenantB = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug)
           VALUES ('Gate 2b Outro Ltda','00000000000065','test-tenant-00000000000065') RETURNING id`,
        )
      ).rows[0].id;
      orgUnitId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
          [tenantA],
        )
      ).rows[0].id;
      requisitionId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at)
           VALUES ($1, $2, 'Req Gate 2b', 'aprovada', now()) RETURNING id`,
          [tenantA, orgUnitId],
        )
      ).rows[0].id;
      jobId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, habilidades_exigidas)
           VALUES ($1, $2, 'Vaga Gate 2b', 'vaga-gate-2b', $3) RETURNING id`,
          [tenantA, requisitionId, ['TypeScript', 'PostgreSQL']],
        )
      ).rows[0].id;
      personId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
           VALUES ('hash-gate-2b','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Gate 2b','gate2b@example.com')
           RETURNING id`,
        )
      ).rows[0].id;
      await adminPool.query(`INSERT INTO person_profile (person_id, habilidades) VALUES ($1, $2)`, [
        personId,
        JSON.stringify([{ nome: 'TypeScript', citacaoVerbatim: 'TypeScript' }]),
      ]);
      applicationId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
          [tenantA, jobId, personId],
        )
      ).rows[0].id;

      const service = new AdherenceService(new PersonService(new EnvelopeEncryptionService()));

      const scoreDoDono = await tenantContext.run(tenantA, (client) => service.porCandidatura(client, applicationId!));
      expect(scoreDoDono).toEqual({
        scoreAderencia: 50,
        skillsBatidas: ['TypeScript'],
        skillsFaltantes: ['PostgreSQL'],
        totalExigidas: 2,
      });

      // Mesmo applicationId, tenant DIFERENTE -- RLS de application/job
      // (FORCE+RESTRICTIVE) deve tornar a candidatura invisível.
      const scoreDeOutroTenant = await tenantContext.run(tenantB!, (client) =>
        service.porCandidatura(client, applicationId!),
      );
      expect(scoreDeOutroTenant).toBeNull();
    } finally {
      if (applicationId) await adminPool.query('DELETE FROM application WHERE id = $1', [applicationId]);
      if (jobId) await adminPool.query('DELETE FROM job WHERE id = $1', [jobId]);
      if (requisitionId) await adminPool.query('DELETE FROM requisition WHERE id = $1', [requisitionId]);
      if (orgUnitId) await adminPool.query('DELETE FROM org_unit WHERE id = $1', [orgUnitId]);
      if (personId) await adminPool.query('DELETE FROM person_profile WHERE person_id = $1', [personId]);
      if (personId) await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
      if (tenantA) await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantA]);
      if (tenantB) await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantB]);
    }
  });
});

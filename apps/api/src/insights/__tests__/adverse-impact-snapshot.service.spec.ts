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

  describe('casos que precisam de vaga própria (para não contaminar as contagens do viés injetado acima)', () => {
    let requisitionId: string;
    let userAccountId: string;
    let jobIsoladoId: string;
    const personIdsIsolados: string[] = [];

    beforeAll(async () => {
      const jobOriginal = await adminPool.query<{ requisition_id: string }>('SELECT requisition_id FROM job WHERE id = $1', [
        jobId,
      ]);
      requisitionId = jobOriginal.rows[0].requisition_id;
      const user = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador-snapshot@example.com') RETURNING id`,
        [tenantId],
      );
      userAccountId = user.rows[0].id;
    });

    afterAll(async () => {
      // Roda ANTES do afterAll externo (Jest resolve do describe mais
      // interno para o mais externo) -- sem isso, o DELETE FROM tenant lá
      // fora estouraria FK violation contra este user_account.
      await adminPool.query('DELETE FROM user_account WHERE id = $1', [userAccountId]);
    });

    afterEach(async () => {
      if (jobIsoladoId) {
        await adminPool.query('DELETE FROM adverse_impact_snapshot WHERE job_id = $1', [jobIsoladoId]);
        await adminPool.query('DELETE FROM decision WHERE application_id IN (SELECT id FROM application WHERE job_id = $1)', [
          jobIsoladoId,
        ]);
        await adminPool.query('DELETE FROM pipeline_stage_transition WHERE application_id IN (SELECT id FROM application WHERE job_id = $1)', [
          jobIsoladoId,
        ]);
        await adminPool.query('DELETE FROM application WHERE job_id = $1', [jobIsoladoId]);
        await adminPool.query('DELETE FROM job WHERE id = $1', [jobIsoladoId]);
      }
      if (personIdsIsolados.length) {
        await adminPool.query('DELETE FROM demographic_self_report WHERE person_id = ANY($1)', [personIdsIsolados]);
        await adminPool.query('DELETE FROM consent WHERE person_id = ANY($1)', [personIdsIsolados]);
        await adminPool.query('DELETE FROM person WHERE id = ANY($1)', [personIdsIsolados]);
        personIdsIsolados.length = 0;
      }
    });

    async function criarCandidatoIsolado(genero: string | null, pcd: boolean | null, alcancaEntrevista: boolean): Promise<string> {
      const p = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ($1, '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Candidato Isolado', $2)
         RETURNING id`,
        [`hash-isolado-${Math.random()}`, `isolado-${Math.random()}@example.com`],
      );
      const personId = p.rows[0].id;
      personIdsIsolados.push(personId);

      const consent = await adminPool.query<{ id: string }>(
        `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal) VALUES ($1, $2, 'autodeclaracao_diversidade', 'consentimento') RETURNING id`,
        [personId, tenantId],
      );
      await adminPool.query(
        `INSERT INTO demographic_self_report (tenant_id, person_id, genero, pcd, consent_id) VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, personId, genero, pcd, consent.rows[0].id],
      );

      const app = await adminPool.query<{ id: string }>(
        `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, jobIsoladoId, personId],
      );
      if (alcancaEntrevista) {
        await adminPool.query(
          `INSERT INTO pipeline_stage_transition (application_id, tenant_id, from_state, to_state, actor_id, actor_type)
           VALUES ($1, $2, 'triagem', 'entrevista', $3, 'user')`,
          [app.rows[0].id, tenantId, personId],
        );
      }
      return app.rows[0].id;
    }

    it('grupo com taxa de seleção ZERO aparece com razão 0, não desaparece do painel', async () => {
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Taxa Zero', 'vaga-taxa-zero') RETURNING id`,
        [tenantId, requisitionId],
      );
      jobIsoladoId = job.rows[0].id;

      // 6 "feminino": NENHUMA alcança entrevista. 6 "masculino": todas alcançam.
      for (let i = 0; i < 6; i++) await criarCandidatoIsolado('feminino', null, false);
      for (let i = 0; i < 6; i++) await criarCandidatoIsolado('masculino', null, true);

      const ctx = new TenantContext(appPool);
      const service = new AdverseImpactSnapshotService();
      await ctx.run(tenantId, (client) => service.recompute(client, tenantId, jobIsoladoId));

      const linhas = await adminPool.query<{ grupo_demografico: string; taxa_selecao: string; razao_4_5: string }>(
        `SELECT grupo_demografico, taxa_selecao, razao_4_5 FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2 AND etapa = 'entrevista'`,
        [tenantId, jobIsoladoId],
      );

      const feminino = linhas.rows.find((r) => r.grupo_demografico === 'genero:feminino');
      expect(feminino).toBeDefined(); // a linha EXISTE -- é o achado central da revisão adversarial
      expect(Number(feminino!.taxa_selecao)).toBe(0);
      expect(Number(feminino!.razao_4_5)).toBe(0);
    });

    it('decision de reprovação NUNCA gera etapa sintética "reprovado" -- decisão consciente pós-revisão adversarial', async () => {
      // Achado de re-revisão adversarial: a primeira versão desta task
      // media reprovação com a MESMA fórmula das etapas de progresso
      // (taxa mais alta = referência boa), mas reprovação é o oposto --
      // taxa mais alta de reprovação é PIOR, não melhor. Isso invertia o
      // sinal: o grupo mais reprovado virava a "referência" (razão 1.0) e
      // um grupo com reprovação baixa podia sair com razão baixa,
      // apontando para o grupo FAVORECIDO como se fosse o prejudicado.
      // Corrigir direito exige medir sobrevivência (não reprovação
      // direta) ou inverter a comparação -- decisão de design própria,
      // fora do escopo desta task. Até essa decisão ser tomada, o
      // serviço não emite o sinal. Este teste trava que decision não
      // produz NENHUMA linha de etapa 'reprovado', mesmo com dado real
      // de reprovação no banco.
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Sem Reprovado', 'vaga-sem-reprovado') RETURNING id`,
        [tenantId, requisitionId],
      );
      jobIsoladoId = job.rows[0].id;

      const appReprovadaId = await criarCandidatoIsolado('feminino', null, true);
      for (let i = 0; i < 4; i++) await criarCandidatoIsolado('feminino', null, true);
      for (let i = 0; i < 5; i++) await criarCandidatoIsolado('masculino', null, false);

      await adminPool.query(
        `INSERT INTO decision (tenant_id, application_id, tipo, decidido_por) VALUES ($1, $2, 'reprovacao', $3)`,
        [tenantId, appReprovadaId, userAccountId],
      );

      const ctx = new TenantContext(appPool);
      const service = new AdverseImpactSnapshotService();
      await ctx.run(tenantId, (client) => service.recompute(client, tenantId, jobIsoladoId));

      const reprovado = await adminPool.query(
        `SELECT 1 FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2 AND etapa = 'reprovado'`,
        [tenantId, jobIsoladoId],
      );
      expect(reprovado.rows).toEqual([]);

      // Controle positivo: a candidatura reprovada CONTINUA contando
      // normalmente na etapa 'entrevista' -- só a etapa sintética de
      // reprovação em si não existe, o resto do funil não é afetado.
      const entrevista = await adminPool.query<{ taxa_selecao: string }>(
        `SELECT taxa_selecao FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2 AND etapa = 'entrevista' AND grupo_demografico = 'genero:feminino'`,
        [tenantId, jobIsoladoId],
      );
      expect(Number(entrevista.rows[0].taxa_selecao)).toBeCloseTo(1, 4);
    });

    it('dimensão pcd (boolean) gera categorias sim/nao, exclui autodeclaração NULL do agrupamento', async () => {
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga PCD', 'vaga-pcd') RETURNING id`,
        [tenantId, requisitionId],
      );
      jobIsoladoId = job.rows[0].id;

      for (let i = 0; i < 5; i++) await criarCandidatoIsolado(null, true, i < 3);
      for (let i = 0; i < 5; i++) await criarCandidatoIsolado(null, null, true); // pcd não declarado

      const ctx = new TenantContext(appPool);
      const service = new AdverseImpactSnapshotService();
      await ctx.run(tenantId, (client) => service.recompute(client, tenantId, jobIsoladoId));

      const linhas = await adminPool.query<{ grupo_demografico: string; taxa_selecao: string }>(
        `SELECT grupo_demografico, taxa_selecao FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2 AND etapa = 'entrevista' AND grupo_demografico LIKE 'pcd:%'`,
        [tenantId, jobIsoladoId],
      );

      expect(linhas.rows).toHaveLength(1); // só "pcd:sim" -- os 5 com pcd NULL não geram "pcd:nao" nem categoria própria
      expect(linhas.rows[0].grupo_demografico).toBe('pcd:sim');
      expect(Number(linhas.rows[0].taxa_selecao)).toBeCloseTo(0.6, 4); // 3 de 5
    });

    it('recompute remove linha obsoleta quando o grupo cai abaixo do limiar mínimo', async () => {
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Limpeza', 'vaga-limpeza') RETURNING id`,
        [tenantId, requisitionId],
      );
      jobIsoladoId = job.rows[0].id;

      for (let i = 0; i < 5; i++) await criarCandidatoIsolado('feminino', null, i < 2);
      for (let i = 0; i < 5; i++) await criarCandidatoIsolado('masculino', null, true);

      const ctx = new TenantContext(appPool);
      const service = new AdverseImpactSnapshotService();
      await ctx.run(tenantId, (client) => service.recompute(client, tenantId, jobIsoladoId));

      const antes = await adminPool.query(
        `SELECT 1 FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2 AND etapa = 'entrevista' AND grupo_demografico = 'genero:feminino'`,
        [tenantId, jobIsoladoId],
      );
      expect(antes.rows).toHaveLength(1); // N=5, no limiar -- linha existe

      // Revoga a autodeclaração de um "feminino" -- grupo cai para N=4, abaixo do limiar.
      await adminPool.query(
        `DELETE FROM demographic_self_report WHERE tenant_id = $1 AND person_id = $2`,
        [tenantId, personIdsIsolados[0]],
      );

      await ctx.run(tenantId, (client) => service.recompute(client, tenantId, jobIsoladoId));

      const depois = await adminPool.query(
        `SELECT 1 FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2 AND etapa = 'entrevista' AND grupo_demografico = 'genero:feminino'`,
        [tenantId, jobIsoladoId],
      );
      expect(depois.rows).toHaveLength(0); // linha obsoleta removida, não presa com valor calculado sobre dado que já não existe
    });

    it('duas chamadas concorrentes de recompute() na MESMA vaga não deixam linha obsoleta -- lock consultivo serializa', async () => {
      // Achado de re-revisão adversarial: sem pg_advisory_xact_lock, duas
      // transações concorrentes podiam se intercalar sob READ COMMITTED
      // de um jeito que o DELETE de uma nunca via o que a outra ainda não
      // tinha commitado -- a linha obsoleta sobrevivia à limpeza.
      // Reproduzido ao vivo pelo revisor com duas conexões reais antes
      // desta correção. Este teste chama recompute() duas vezes em
      // paralelo (Promise.all, duas conexões distintas do pool) e afirma
      // que a contagem final bate exatamente com o esperado -- nem
      // duplicada, nem com sobra.
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Concorrencia', 'vaga-concorrencia') RETURNING id`,
        [tenantId, requisitionId],
      );
      jobIsoladoId = job.rows[0].id;

      for (let i = 0; i < 5; i++) await criarCandidatoIsolado('feminino', null, i < 2);
      for (let i = 0; i < 5; i++) await criarCandidatoIsolado('masculino', null, true);

      const service = new AdverseImpactSnapshotService();
      const ctxA = new TenantContext(appPool);
      const ctxB = new TenantContext(appPool);

      await Promise.all([
        ctxA.run(tenantId, (client) => service.recompute(client, tenantId, jobIsoladoId)),
        ctxB.run(tenantId, (client) => service.recompute(client, tenantId, jobIsoladoId)),
      ]);

      const total = await adminPool.query(
        `SELECT count(*) FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2`,
        [tenantId, jobIsoladoId],
      );
      // 2 etapas (triagem, entrevista) x 2 categorias de gênero = 4 linhas
      // -- mesmo resultado de uma chamada só, nenhuma sobra de corrida.
      expect(Number(total.rows[0].count)).toBe(4);

      const feminino = await adminPool.query<{ taxa_selecao: string }>(
        `SELECT taxa_selecao FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2 AND etapa = 'entrevista' AND grupo_demografico = 'genero:feminino'`,
        [tenantId, jobIsoladoId],
      );
      expect(Number(feminino.rows[0].taxa_selecao)).toBeCloseTo(0.4, 4); // 2 de 5
    });
  });
});

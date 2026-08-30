import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { EnvelopeEncryptionService } from '../../talent/envelope-encryption.service';
import { PersonService } from '../../talent/person.service';
import { AdherenceService, QUERY_ADERENCIA_POR_CANDIDATURA } from '../adherence.service';

describe('AdherenceService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let outroTenantId: string;
  let jobComSkillsId: string;
  let jobSemSkillsId: string;
  let personComPerfilId: string;
  let personSemPerfilId: string;
  let applicationComPerfilId: string;
  let applicationSemPerfilId: string;
  let applicationVagaSemRequisitoId: string;

  function buildService(): AdherenceService {
    return new AdherenceService(new PersonService(new EnvelopeEncryptionService()));
  }

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Adherence', '00000000000062', 'test-tenant-00000000000062') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const outro = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Adherence Outro', '00000000000063', 'test-tenant-00000000000063') RETURNING id`,
    );
    outroTenantId = outro.rows[0].id;

    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Adherence', 'aprovada', now()) RETURNING id`,
      [tenantId, org.rows[0].id],
    );

    const jobComSkills = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, habilidades_exigidas)
       VALUES ($1, $2, 'Vaga Com Skills', 'vaga-adherence-com-skills', $3) RETURNING id`,
      [tenantId, req.rows[0].id, ['TypeScript', 'PostgreSQL']],
    );
    jobComSkillsId = jobComSkills.rows[0].id;

    const jobSemSkills = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug)
       VALUES ($1, $2, 'Vaga Sem Skills', 'vaga-adherence-sem-skills') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobSemSkillsId = jobSemSkills.rows[0].id;

    const personComPerfil = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-adherence-1', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Candidato Com Perfil', 'com.perfil@example.com')
       RETURNING id`,
    );
    personComPerfilId = personComPerfil.rows[0].id;
    await adminPool.query(
      `INSERT INTO person_profile (person_id, habilidades) VALUES ($1, $2)`,
      [personComPerfilId, JSON.stringify([{ nome: 'TypeScript', citacaoVerbatim: 'TypeScript' }])],
    );

    const personSemPerfil = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-adherence-2', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Candidato Sem Perfil', 'sem.perfil@example.com')
       RETURNING id`,
    );
    personSemPerfilId = personSemPerfil.rows[0].id;

    const appComPerfil = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, jobComSkillsId, personComPerfilId],
    );
    applicationComPerfilId = appComPerfil.rows[0].id;

    const appSemPerfil = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, jobComSkillsId, personSemPerfilId],
    );
    applicationSemPerfilId = appSemPerfil.rows[0].id;

    const appVagaSemRequisito = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, jobSemSkillsId, personComPerfilId],
    );
    applicationVagaSemRequisitoId = appVagaSemRequisito.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person_profile WHERE person_id = $1', [personComPerfilId]);
    await adminPool.query('DELETE FROM person WHERE id = ANY($1)', [[personComPerfilId, personSemPerfilId]]);
    await adminPool.query('DELETE FROM tenant WHERE id = ANY($1)', [[tenantId, outroTenantId]]);
    await adminPool.end();
    await appPool.end();
  });

  it('calcula o score de uma candidatura com perfil batendo skills exigidas', async () => {
    const ctx = new TenantContext(appPool);
    const service = buildService();

    const resultado = await ctx.run(tenantId, (client) => service.porCandidatura(client, applicationComPerfilId));

    expect(resultado).toEqual({
      scoreAderencia: 50,
      skillsBatidas: ['TypeScript'],
      skillsFaltantes: ['PostgreSQL'],
      totalExigidas: 2,
    });
  });

  it('candidato sem person_profile (currículo ainda não processado) devolve score 0, não erro', async () => {
    const ctx = new TenantContext(appPool);
    const service = buildService();

    const resultado = await ctx.run(tenantId, (client) => service.porCandidatura(client, applicationSemPerfilId));

    expect(resultado).toEqual({
      scoreAderencia: 0,
      skillsBatidas: [],
      skillsFaltantes: ['TypeScript', 'PostgreSQL'],
      totalExigidas: 2,
    });
  });

  it('vaga sem requisito declarado devolve score null', async () => {
    const ctx = new TenantContext(appPool);
    const service = buildService();

    const resultado = await ctx.run(tenantId, (client) =>
      service.porCandidatura(client, applicationVagaSemRequisitoId),
    );

    expect(resultado?.scoreAderencia).toBeNull();
  });

  it('candidatura inexistente devolve null', async () => {
    const ctx = new TenantContext(appPool);
    const service = buildService();

    const resultado = await ctx.run(tenantId, (client) =>
      service.porCandidatura(client, '00000000-0000-0000-0000-000000000000'),
    );

    expect(resultado).toBeNull();
  });

  it('candidatura de outro tenant é invisível via RLS -- devolve null, não vaza dado cross-tenant', async () => {
    const ctx = new TenantContext(appPool);
    const service = buildService();

    const resultado = await ctx.run(outroTenantId, (client) =>
      service.porCandidatura(client, applicationComPerfilId),
    );

    expect(resultado).toBeNull();
  });

  it('allowlist estrutural: a query só seleciona habilidades_exigidas (feature) e person_id (chave de junção) -- nenhuma outra coluna de job/application', () => {
    // Guarda contra regressão real, não só contra as colunas proibidas que
    // eu lembrei de listar hoje: em vez de checar "essas 16 colunas não
    // aparecem" (blocklist, que deixa passar qualquer coluna sensível fora
    // da lista -- ex. telefone, raça/cor, deficiência -- sem ser prevista),
    // este teste afirma SUBCONJUNTO nas duas direções: toda coluna
    // permitida está na query, e toda coluna DA QUERY está na lista
    // permitida. Isso rejeita QUALQUER coluna fora das duas, não só as que
    // eu antecipei -- é a diferença entre allowlist de verdade e blocklist
    // disfarçado (achado de revisão adversarial da Task 3).
    const colunasPermitidas = ['habilidades_exigidas', 'person_id'];

    const selectClause = QUERY_ADERENCIA_POR_CANDIDATURA.match(/SELECT([\s\S]*?)FROM/i)?.[1] ?? '';
    const colunasNaQuery = new Set(
      selectClause
        .split(/[\s,]+/)
        .map((token) => token.replace(/^[a-z]+\./i, '').toLowerCase())
        .filter(Boolean),
    );

    for (const permitida of colunasPermitidas) {
      expect(colunasNaQuery.has(permitida)).toBe(true);
    }
    for (const coluna of colunasNaQuery) {
      expect(colunasPermitidas).toContain(coluna);
    }
  });

  it('a leitura de habilidades do candidato passa por PersonService -- nunca SQL direto contra person_profile neste módulo', () => {
    // Achado de revisão adversarial da Task 3: a versão anterior desta
    // query fazia LEFT JOIN direto em person_profile, contrariando o
    // design (§2) de que só PersonService lê aquela tabela. Este teste
    // fixa a correção -- falha se alguém reintroduzir "person_profile" no
    // texto da query desta classe.
    expect(QUERY_ADERENCIA_POR_CANDIDATURA.toLowerCase()).not.toContain('person_profile');
  });

  describe('porCandidaturasDaVaga', () => {
    const ctx = new TenantContext(appPool);

    let orgUnitLoteId: string;
    let requisitionLoteId: string;
    let vagaComHabilidadesId: string;
    let vagaSemHabilidadesId: string;
    let personSemPerfilId: string;

    beforeAll(async () => {
      // `requisitionId` não está em escopo nesta suíte (a `requisition`
      // criada no `beforeAll` externo só vive na variável local `req`) --
      // por isso este bloco cria a sua própria org_unit + requisição
      // aprovada, no mesmo padrão de job.service.spec.ts, e as remove no
      // afterAll correspondente.
      const org = await adminPool.query<{ id: string }>(
        `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz Lote', 'matriz-lote') RETURNING id`,
        [tenantId],
      );
      orgUnitLoteId = org.rows[0].id;

      const req = await adminPool.query<{ id: string }>(
        `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Adherence Lote', 'aprovada', now()) RETURNING id`,
        [tenantId, orgUnitLoteId],
      );
      requisitionLoteId = req.rows[0].id;

      const comSkills = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, habilidades_exigidas)
         VALUES ($1, $2, 'Vaga Com Skills', 'vaga-com-skills-lote', ARRAY['TypeScript','Go'])
         RETURNING id`,
        [tenantId, requisitionLoteId],
      );
      vagaComHabilidadesId = comSkills.rows[0].id;

      const semSkills = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, habilidades_exigidas)
         VALUES ($1, $2, 'Vaga Sem Skills', 'vaga-sem-skills-lote', ARRAY[]::text[])
         RETURNING id`,
        [tenantId, requisitionLoteId],
      );
      vagaSemHabilidadesId = semSkills.rows[0].id;

      const pessoa = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-sem-perfil-lote', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Sem Perfil Lote', 'semperfil.lote@example.com')
         RETURNING id`,
      );
      personSemPerfilId = pessoa.rows[0].id;
    });

    afterAll(async () => {
      await adminPool.query('DELETE FROM job WHERE id = ANY($1)', [
        [vagaComHabilidadesId, vagaSemHabilidadesId],
      ]);
      await adminPool.query('DELETE FROM requisition WHERE id = $1', [requisitionLoteId]);
      await adminPool.query('DELETE FROM org_unit WHERE id = $1', [orgUnitLoteId]);
      await adminPool.query('DELETE FROM person WHERE id = $1', [personSemPerfilId]);
    });

    it('devolve null para todos quando a vaga não exige habilidades', async () => {
      const service = new AdherenceService(new PersonService(new EnvelopeEncryptionService()));
      const mapa = await ctx.run(tenantId, (client) =>
        service.porCandidaturasDaVaga(client, {
          jobId: vagaSemHabilidadesId,
          candidatos: [{ applicationId: 'app-1', personId: personComPerfilId }],
        }),
      );
      expect(mapa.get('app-1')).toBeNull();
    });

    it('dá score 0 para candidato sem perfil quando a vaga exige habilidades', async () => {
      const service = new AdherenceService(new PersonService(new EnvelopeEncryptionService()));
      const mapa = await ctx.run(tenantId, (client) =>
        service.porCandidaturasDaVaga(client, {
          jobId: vagaComHabilidadesId,
          candidatos: [{ applicationId: 'app-2', personId: personSemPerfilId }],
        }),
      );
      expect(mapa.get('app-2')).toBe(0);
    });

    it('não faz uma consulta por candidato -- o custo não cresce com o número deles', async () => {
      // O ponto desta fase: chamar habilidades() em laço daria N+1. Duas
      // consultas fixas (habilidades exigidas da vaga + habilidades em lote)
      // independentemente de quantos candidatos entram.
      const service = new AdherenceService(new PersonService(new EnvelopeEncryptionService()));
      const candidatos = Array.from({ length: 25 }, (_, i) => ({
        applicationId: `app-${i}`,
        personId: personComPerfilId,
      }));
      let consultas = 0;
      await ctx.run(tenantId, async (client) => {
        const original = client.query.bind(client);
        (client as unknown as { query: unknown }).query = (...args: unknown[]) => {
          consultas++;
          return (original as (...a: unknown[]) => unknown)(...args);
        };
        await service.porCandidaturasDaVaga(client, { jobId: vagaComHabilidadesId, candidatos });
        // Restaura client.query ANTES de devolver o controle a ctx.run --
        // senão o COMMIT que TenantContext.run emite depois deste callback
        // também seria contado (o mock mutou a propriedade no próprio
        // objeto client, então continua interceptando até ser desfeito).
        // Sem isto, `consultas` mediria "duas consultas do serviço + um
        // COMMIT alheio", não o que este teste se propõe a medir.
        (client as unknown as { query: unknown }).query = original;
      });
      expect(consultas).toBe(2);
    });

    it('com nenhum candidato devolve mapa vazio', async () => {
      const service = new AdherenceService(new PersonService(new EnvelopeEncryptionService()));
      const mapa = await ctx.run(tenantId, (client) =>
        service.porCandidaturasDaVaga(client, { jobId: vagaComHabilidadesId, candidatos: [] }),
      );
      expect(mapa.size).toBe(0);
    });
  });
});

import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
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
    const service = new AdherenceService();

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
    const service = new AdherenceService();

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
    const service = new AdherenceService();

    const resultado = await ctx.run(tenantId, (client) =>
      service.porCandidatura(client, applicationVagaSemRequisitoId),
    );

    expect(resultado?.scoreAderencia).toBeNull();
  });

  it('candidatura inexistente devolve null', async () => {
    const ctx = new TenantContext(appPool);
    const service = new AdherenceService();

    const resultado = await ctx.run(tenantId, (client) =>
      service.porCandidatura(client, '00000000-0000-0000-0000-000000000000'),
    );

    expect(resultado).toBeNull();
  });

  it('candidatura de outro tenant é invisível via RLS -- devolve null, não vaza dado cross-tenant', async () => {
    const ctx = new TenantContext(appPool);
    const service = new AdherenceService();

    const resultado = await ctx.run(outroTenantId, (client) =>
      service.porCandidatura(client, applicationComPerfilId),
    );

    expect(resultado).toBeNull();
  });

  it('allowlist estrutural: a query só seleciona habilidades_exigidas e habilidades -- nenhuma outra coluna de job/person/person_profile', () => {
    // Guarda contra regressão: se alguém expandir esta query para trazer
    // nome/email/cpf/data_nascimento/etc. no futuro, este teste falha antes
    // de virar um vazamento de feature proibida. Mesmo padrão de "asserção
    // que não pode passar vazia" do faking-vulnerability.spec.ts (Fase 2a).
    const colunasPermitidas = ['habilidades_exigidas', 'habilidades'];
    const colunasProibidas = [
      'cep',
      'idade',
      'data_nascimento',
      'genero',
      'nome',
      'email_principal',
      'foto',
      'estado_civil',
      'nacionalidade',
      'instituicao',
      'ano_formatura',
      'cpf_hash',
      'cpf_encriptado',
      'resumo',
      'experiencias',
      'formacao',
    ];

    // Tokeniza em vez de checar substring: "habilidades" CONTÉM "idade"
    // como substring ("habil-idade-s"), então um check de substring daria
    // falso positivo na própria coluna permitida. Tokens exatos (separados
    // por vírgula/espaço, com o alias de tabela removido) evitam essa
    // classe de colisão para qualquer nome de coluna futuro.
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
    for (const proibida of colunasProibidas) {
      expect(colunasNaQuery.has(proibida)).toBe(false);
    }
  });
});

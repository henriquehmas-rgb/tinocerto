import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { RequisitionService } from '../requisition.service';
import { JobService } from '../job.service';
import { JobRecrutadorService, RecrutadorInvalidoError } from '../job-recrutador.service';

describe('JobService', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenantId: string;
  let orgUnitId: string;
  let requisitionId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Job', '00000000000018', 'test-tenant-00000000000018') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    orgUnitId = org.rows[0].id;
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Requisição para Job', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnitId],
    );
    requisitionId = req.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    // instrument/instrument_version são tabelas GLOBAIS (sem tenant_id) --
    // precisam de limpeza explícita por id, senão os UUIDs fixos usados
    // nos testes de instrumentVersionId acima colidem (chave duplicada)
    // numa segunda execução da suíte.
    await adminPool.query(
      "DELETE FROM instrument_version WHERE id IN ('a55e55e0-0000-4000-8000-000000000098', 'a55e55e0-0000-4000-8000-0000000000a2', 'a55e55e0-0000-4000-8000-0000000000c2')",
    );
    await adminPool.query(
      "DELETE FROM instrument WHERE id IN ('a55e55e0-0000-4000-8000-000000000099', 'a55e55e0-0000-4000-8000-0000000000a1', 'a55e55e0-0000-4000-8000-0000000000c1')",
    );
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  // Item 3b da onda 2 de correção pós-revisão: JobService.create chama
  // JobRecrutadorService.atribuir na MESMA transação -- um UUID
  // bem-formado mas de um user_account inexistente/de outro tenant
  // estourava a FK composta fk_job_recrutador_tenant_staff como um 500 cru
  // via este caminho (POST /v1/jobs), não só via
  // atribuir-recrutadores (já coberto em job-recrutador.service.spec.ts).
  // Este teste prova que o erro se propaga como RecrutadorInvalidoError
  // (não um pg error cru) através de JobService.create, para o controller
  // poder traduzi-lo em 400 -- ver JobController.create.
  it('create lança RecrutadorInvalidoError (não um erro cru do Postgres) quando recrutadorIds contém um UUID que não existe em user_account', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobService(new RequisitionService(), new JobRecrutadorService());
    const uuidInexistente = '00000000-0000-4000-8000-000000000001';

    await expect(
      ctx.run(tenantId, (client) =>
        service.create(client, {
          tenantId,
          requisitionId,
          titulo: 'Vaga com Recrutador Inválido',
          recrutadorIds: [uuidInexistente],
        }),
      ),
    ).rejects.toBeInstanceOf(RecrutadorInvalidoError);
  });

  it('cria uma vaga em rascunho com seo_slug único e sem publicado_em', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobService(new RequisitionService(), new JobRecrutadorService());

    const { id } = await ctx.run(tenantId, (client) =>
      service.create(client, { tenantId, requisitionId, titulo: 'Analista de Operações Pleno' }),
    );

    const row = await adminPool.query('SELECT * FROM job WHERE id = $1', [id]);
    expect(row.rows[0].seo_slug).toMatch(/^analista-de-operacoes-pleno-[0-9a-f]{4}$/);
    expect(row.rows[0].publicado_em).toBeNull();
  });

  it('publica uma vaga e grava job.published com os canais informados', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobService(new RequisitionService(), new JobRecrutadorService());

    const { id } = await ctx.run(tenantId, (client) =>
      service.create(client, { tenantId, requisitionId, titulo: 'Vaga a Publicar' }),
    );

    await ctx.run(tenantId, (client) => service.publish(client, id, ['site_carreiras', 'google_for_jobs']));

    const row = await adminPool.query('SELECT publicado_em, canais FROM job WHERE id = $1', [id]);
    expect(row.rows[0].publicado_em).not.toBeNull();
    expect(row.rows[0].canais).toEqual(['site_carreiras', 'google_for_jobs']);

    const events = await adminPool.query(
      `SELECT payload FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'job.published'`,
      [id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload.canais).toEqual(['site_carreiras', 'google_for_jobs']);
  });

  it('rejeita criar vaga para requisição de outro tenant (checagem de tenant em JobService.create via RequisitionService.findById)', async () => {
    const outroTenant = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Job Outro', '00000000000019', 'test-tenant-00000000000019') RETURNING id`,
    );
    const ctx = new TenantContext(appPool);
    const service = new JobService(new RequisitionService(), new JobRecrutadorService());

    await expect(
      ctx.run(outroTenant.rows[0].id, (client) =>
        service.create(client, {
          tenantId: outroTenant.rows[0].id,
          requisitionId, // pertence ao tenant original, não a outroTenant
          titulo: 'Vaga Vazando Requisição',
        }),
      ),
    ).rejects.toThrow();

    await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenant.rows[0].id]);
  });

  it('a FK composta fk_job_tenant_requisition barra, no nível do banco, um INSERT direto em job com requisition_id de outro tenant — independente de qualquer checagem em nível de aplicação', async () => {
    // Este teste ignora deliberadamente o JobService/RequisitionService e insere
    // direto via adminPool (role "tinocerto", Superuser + Bypass RLS — ver
    // "\du" no Postgres), para provar que a própria FK composta
    // (tenant_id, requisition_id) REFERENCES requisition (tenant_id, id)
    // protege contra vazamento cross-tenant mesmo que o pré-check de
    // JobService.create (RequisitionService.findById + comparação de
    // tenantId) algum dia seja removido ou enfraquecido num refactor futuro.
    // Sem este teste, a suíte inteira poderia "passar" mesmo que a FK fosse
    // derrubada da migration, pois o teste acima já barra a criação antes do
    // INSERT (achado de revisão da Task 8, fix round 1).
    const outroTenant = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Job FK Direta', '00000000000020', 'test-tenant-00000000000020') RETURNING id`,
    );
    const outroTenantId = outroTenant.rows[0].id;

    await expect(
      adminPool.query(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Cross-Tenant Direta', 'vaga-cross-tenant-direta-xxxx')`,
        [outroTenantId, requisitionId], // requisitionId pertence ao tenant original, não a outroTenantId
      ),
    ).rejects.toThrow(/fk_job_tenant_requisition/);

    await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenantId]);
  });

  it('cria uma vaga com habilidades_exigidas quando informado, e com array vazio quando omitido', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobService(new RequisitionService(), new JobRecrutadorService());

    const { id: comHabilidades } = await ctx.run(tenantId, (client) =>
      service.create(client, {
        tenantId,
        requisitionId,
        titulo: 'Vaga Com Skills',
        habilidadesExigidas: ['TypeScript', 'PostgreSQL'],
      }),
    );
    const { id: semHabilidades } = await ctx.run(tenantId, (client) =>
      service.create(client, { tenantId, requisitionId, titulo: 'Vaga Sem Skills' }),
    );

    const rows = await adminPool.query('SELECT id, habilidades_exigidas FROM job WHERE id = ANY($1)', [
      [comHabilidades, semHabilidades],
    ]);
    const porId = Object.fromEntries(rows.rows.map((r) => [r.id, r.habilidades_exigidas]));
    expect(porId[comHabilidades]).toEqual(['TypeScript', 'PostgreSQL']);
    expect(porId[semHabilidades]).toEqual([]);
  });

  it('declararHabilidadesExigidas substitui a lista de skills exigidas de uma vaga existente', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobService(new RequisitionService(), new JobRecrutadorService());

    const { id } = await ctx.run(tenantId, (client) =>
      service.create(client, { tenantId, requisitionId, titulo: 'Vaga a Editar Skills' }),
    );

    await ctx.run(tenantId, (client) => service.declararHabilidadesExigidas(client, id, ['React', 'Node.js']));

    const row = await adminPool.query('SELECT habilidades_exigidas FROM job WHERE id = $1', [id]);
    expect(row.rows[0].habilidades_exigidas).toEqual(['React', 'Node.js']);
  });

  it('declararHabilidadesExigidas rejeita vaga inexistente', async () => {
    const ctx = new TenantContext(appPool);
    const service = new JobService(new RequisitionService(), new JobRecrutadorService());

    await expect(
      ctx.run(tenantId, (client) =>
        service.declararHabilidadesExigidas(client, '00000000-0000-0000-0000-000000000000', ['React']),
      ),
    ).rejects.toThrow(/não encontrada/);
  });

  describe('listar', () => {
    let vagaAtribuidaId: string;
    let vagaNaoAtribuidaId: string;
    let recrutadorId: string;
    // Não existe em user_account -- listar() só usa userId como parâmetro de
    // query quando o papel é "recrutador puro"; para admin_tenant/gestor_vaga
    // o userId nunca entra na query, então não precisa existir de fato.
    const adminId = '00000000-0000-0000-0000-000000000099';

    beforeAll(async () => {
      const jobA = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Listar Atribuída', 'vaga-listar-atribuida-0018') RETURNING id`,
        [tenantId, requisitionId],
      );
      vagaAtribuidaId = jobA.rows[0].id;
      const jobB = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Listar Não Atribuída', 'vaga-listar-nao-atribuida-0018') RETURNING id`,
        [tenantId, requisitionId],
      );
      vagaNaoAtribuidaId = jobB.rows[0].id;
      const staff = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador-listar@empresa-018.example') RETURNING id`,
        [tenantId],
      );
      recrutadorId = staff.rows[0].id;
      await adminPool.query(`INSERT INTO job_recrutador (job_id, tenant_id, staff_id) VALUES ($1, $2, $3)`, [
        vagaAtribuidaId,
        tenantId,
        recrutadorId,
      ]);
      const person = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-listar-contagem', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Fabio Contagem', 'fabio.contagem@example.com')
         RETURNING id`,
      );
      await adminPool.query(
        `INSERT INTO application (tenant_id, job_id, person_id, etapa_funil) VALUES ($1, $2, $3, 'triagem')`,
        [tenantId, vagaAtribuidaId, person.rows[0].id],
      );
    });

    afterAll(async () => {
      await adminPool.query('DELETE FROM application WHERE job_id = $1', [vagaAtribuidaId]);
      await adminPool.query('DELETE FROM person WHERE cpf_hash = $1', ['hash-listar-contagem']);
      await adminPool.query('DELETE FROM job_recrutador WHERE tenant_id = $1 AND staff_id = $2', [
        tenantId,
        recrutadorId,
      ]);
      await adminPool.query('DELETE FROM user_account WHERE id = $1', [recrutadorId]);
      await adminPool.query('DELETE FROM job WHERE id = ANY($1)', [[vagaAtribuidaId, vagaNaoAtribuidaId]]);
    });

    it('retorna todas as vagas do tenant para admin_tenant', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());

      const vagas = await ctx.run(tenantId, (client) =>
        service.listar(client, { tenantId, userId: adminId, userRoles: ['admin_tenant'] }),
      );

      // O tenant já acumula outras vagas criadas pelos testes acima nesta
      // mesma suíte (mesmo tenantId compartilhado) -- por isso
      // arrayContaining em vez de toHaveLength(2) como no brief, que
      // assumia um fixture isolado por describe.
      expect(vagas.map((v) => v.id)).toEqual(expect.arrayContaining([vagaAtribuidaId, vagaNaoAtribuidaId]));
    });

    it('retorna só as vagas atribuídas para um recrutador puro', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());

      const vagas = await ctx.run(tenantId, (client) =>
        service.listar(client, { tenantId, userId: recrutadorId, userRoles: ['recrutador'] }),
      );

      expect(vagas).toEqual([expect.objectContaining({ id: vagaAtribuidaId, contagemCandidaturas: 1 })]);
    });
  });

  describe('funil', () => {
    let vagaFunilId: string;
    let vagaSemCandidaturasId: string;
    let personTriagemId: string;
    let personEntrevistaId: string;
    let personOfertaId: string;
    let applicationTriagemId: string;
    let applicationEntrevistaId: string;
    let applicationOfertaId: string;
    let instrumentVersionFunilId: string;
    // Não existe em user_account -- actor_id de pipeline_stage_transition
    // não tem FK para user_account, então não precisa existir de fato.
    const adminId = '00000000-0000-0000-0000-000000000097';

    beforeAll(async () => {
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Funil', 'vaga-funil-0018') RETURNING id`,
        [tenantId, requisitionId],
      );
      vagaFunilId = job.rows[0].id;

      const vagaSemCandidaturas = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Funil Sem Candidaturas', 'vaga-funil-sem-candidaturas-0018') RETURNING id`,
        [tenantId, requisitionId],
      );
      vagaSemCandidaturasId = vagaSemCandidaturas.rows[0].id;

      const personA = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-funil-triagem', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Bruna Triagem', 'bruna.triagem@example.com')
         RETURNING id`,
      );
      personTriagemId = personA.rows[0].id;
      const personB = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-funil-entrevista', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Caio Entrevista', 'caio.entrevista@example.com')
         RETURNING id`,
      );
      personEntrevistaId = personB.rows[0].id;
      const personC = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-funil-oferta', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Duda Oferta', 'duda.oferta@example.com')
         RETURNING id`,
      );
      personOfertaId = personC.rows[0].id;

      const appTriagem = await adminPool.query<{ id: string }>(
        `INSERT INTO application (tenant_id, job_id, person_id, etapa_funil) VALUES ($1, $2, $3, 'triagem') RETURNING id`,
        [tenantId, vagaFunilId, personTriagemId],
      );
      applicationTriagemId = appTriagem.rows[0].id;
      const appEntrevista = await adminPool.query<{ id: string }>(
        `INSERT INTO application (tenant_id, job_id, person_id, etapa_funil) VALUES ($1, $2, $3, 'entrevista') RETURNING id`,
        [tenantId, vagaFunilId, personEntrevistaId],
      );
      applicationEntrevistaId = appEntrevista.rows[0].id;
      // 'oferta' fica fora de ORDEM_ETAPAS (só ['triagem', 'entrevista']):
      // existe nos dados do funil, mas não deve receber conversão
      // inventada. Sem esta candidatura, o teste de etapa desconhecida
      // passaria com qualquer implementação -- inclusive uma que iterasse
      // as chaves dos dados em vez de ORDEM_ETAPAS.
      const appOferta = await adminPool.query<{ id: string }>(
        `INSERT INTO application (tenant_id, job_id, person_id, etapa_funil) VALUES ($1, $2, $3, 'oferta') RETURNING id`,
        [tenantId, vagaFunilId, personOfertaId],
      );
      applicationOfertaId = appOferta.rows[0].id;

      // instrument/instrument_version são tabelas GLOBAIS (sem tenant_id):
      // ids fixos + limpeza explícita no afterAll, mesmo padrão já usado
      // nos testes de instrumentVersionId desta suíte.
      await adminPool.query(
        `INSERT INTO instrument (id, nome) VALUES ('a55e55e0-0000-4000-8000-0000000000f1', 'Instrumento Funil')`,
      );
      await adminPool.query(
        `INSERT INTO instrument_version (id, instrument_id, versao)
         VALUES ('a55e55e0-0000-4000-8000-0000000000f2', 'a55e55e0-0000-4000-8000-0000000000f1', 1)`,
      );
      instrumentVersionFunilId = 'a55e55e0-0000-4000-8000-0000000000f2';

      await adminPool.query(
        `INSERT INTO assessment_application (tenant_id, application_id, person_id, instrument_version_id, status, convidado_em)
         VALUES ($1, $2, $3, $4, 'concluido', now())`,
        [tenantId, applicationTriagemId, personTriagemId, instrumentVersionFunilId],
      );

      const touchpoint = await adminPool.query<{ id: string }>(
        `INSERT INTO candidate_touchpoint (tenant_id, person_id, canal) VALUES ($1, $2, 'site_carreiras') RETURNING id`,
        [tenantId, personTriagemId],
      );
      await adminPool.query(`UPDATE application SET touchpoint_id = $1 WHERE id = $2`, [
        touchpoint.rows[0].id,
        applicationTriagemId,
      ]);

      // A candidatura de entrevista passou por triagem antes: sem esta
      // transição o denominador da conversão seria só quem está em triagem
      // agora, e o teste de 50% não teria significado.
      await adminPool.query(
        `INSERT INTO pipeline_stage_transition (tenant_id, application_id, from_state, to_state, actor_id, actor_type)
         VALUES ($1, $2, 'triagem', 'entrevista', $3, 'staff')`,
        [tenantId, applicationEntrevistaId, adminId],
      );
    });

    afterAll(async () => {
      await adminPool.query('DELETE FROM pipeline_stage_transition WHERE tenant_id = $1', [tenantId]);
      await adminPool.query('DELETE FROM assessment_application WHERE tenant_id = $1', [tenantId]);
      await adminPool.query('UPDATE application SET touchpoint_id = NULL WHERE id = $1', [applicationTriagemId]);
      await adminPool.query('DELETE FROM candidate_touchpoint WHERE tenant_id = $1', [tenantId]);
      await adminPool.query('DELETE FROM application WHERE id = ANY($1)', [
        [applicationTriagemId, applicationEntrevistaId, applicationOfertaId],
      ]);
      await adminPool.query('DELETE FROM job WHERE id = ANY($1)', [[vagaFunilId, vagaSemCandidaturasId]]);
      await adminPool.query('DELETE FROM person WHERE id = ANY($1)', [
        [personTriagemId, personEntrevistaId, personOfertaId],
      ]);
      await adminPool.query(`DELETE FROM instrument_version WHERE id = 'a55e55e0-0000-4000-8000-0000000000f2'`);
      await adminPool.query(`DELETE FROM instrument WHERE id = 'a55e55e0-0000-4000-8000-0000000000f1'`);
    });

    it('agrupa candidaturas da vaga por etapa_funil', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());

      const { funil } = await ctx.run(tenantId, (client) =>
        service.funil(client, { tenantId, jobId: vagaFunilId }),
      );

      expect(funil).toEqual({
        triagem: [expect.objectContaining({ id: applicationTriagemId })],
        entrevista: [expect.objectContaining({ id: applicationEntrevistaId })],
        oferta: [expect.objectContaining({ id: applicationOfertaId })],
      });
    });

    it('devolve status do assessment e canal de origem por candidatura', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());

      const { funil } = await ctx.run(tenantId, (client) =>
        service.funil(client, { tenantId, jobId: vagaFunilId }),
      );

      const emTriagem = funil['triagem'].find((c) => c.id === applicationTriagemId)!;
      expect(emTriagem.assessmentStatus).toBe('concluido');
      expect(emTriagem.origemCanal).toBe('site_carreiras');
    });

    it('devolve null nos campos novos quando não há assessment nem origem', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());

      const { funil } = await ctx.run(tenantId, (client) =>
        service.funil(client, { tenantId, jobId: vagaFunilId }),
      );

      const semNada = funil['entrevista'].find((c) => c.id === applicationEntrevistaId)!;
      expect(semNada.assessmentStatus).toBeNull();
      expect(semNada.origemCanal).toBeNull();
    });

    it('quando há reaplicação, vale o assessment mais recente', async () => {
      // Insere um assessment ANTERIOR ao já existente: o mais recente por
      // convidado_em é que deve aparecer, não o primeiro nem o último a ser
      // inserido.
      const assessmentAnterior = await adminPool.query<{ id: string }>(
        `INSERT INTO assessment_application (tenant_id, application_id, person_id, instrument_version_id, status, convidado_em)
         VALUES ($1, $2, $3, $4, 'convidado', now() - interval '10 days') RETURNING id`,
        [tenantId, applicationTriagemId, personTriagemId, instrumentVersionFunilId],
      );

      try {
        const ctx = new TenantContext(appPool);
        const service = new JobService(new RequisitionService(), new JobRecrutadorService());
        const { funil } = await ctx.run(tenantId, (client) =>
          service.funil(client, { tenantId, jobId: vagaFunilId }),
        );

        const emTriagem = funil['triagem'].find((c) => c.id === applicationTriagemId)!;
        expect(emTriagem.assessmentStatus).toBe('concluido');
      } finally {
        // Não deixa a linha extra para trás: testes posteriores neste
        // bloco (e o afterAll, que só limpa por tenant) não devem depender
        // da ordem de execução para ver um único assessment por
        // candidatura.
        await adminPool.query('DELETE FROM assessment_application WHERE id = $1', [assessmentAnterior.rows[0].id]);
      }
    });

    it('a primeira etapa não tem conversão', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());
      const { conversao } = await ctx.run(tenantId, (client) =>
        service.funil(client, { tenantId, jobId: vagaFunilId }),
      );
      expect(conversao['triagem']).toBeNull();
    });

    it('conta como tendo alcançado triagem quem nasceu lá sem transição', async () => {
      // Candidaturas nascem em 'triagem' sem gerar linha em
      // pipeline_stage_transition. Contar só transições daria denominador
      // zero e conversão nula para sempre.
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());
      const { conversao } = await ctx.run(tenantId, (client) =>
        service.funil(client, { tenantId, jobId: vagaFunilId }),
      );
      // Das 3 candidaturas na vaga, 2 alcançaram triagem (uma está lá,
      // outra passou por lá antes de ir para entrevista; a terceira está em
      // 'oferta', que nunca passou por triagem nem entrevista). Uma
      // alcançou entrevista. Logo 1/2 = 50%.
      expect(conversao['entrevista']).toBe(50);
    });

    it('etapa fora da ordem conhecida não recebe conversão inventada', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());
      const { conversao } = await ctx.run(tenantId, (client) =>
        service.funil(client, { tenantId, jobId: vagaFunilId }),
      );
      expect(conversao['etapa-inexistente']).toBeUndefined();
      // 'oferta' existe nos dados do funil (há uma candidatura lá -- ver
      // fixture no beforeAll) mas está fora de ORDEM_ETAPAS, então não deve
      // receber conversão. Sem uma candidatura real em 'oferta', esta
      // asserção passaria mesmo se a implementação iterasse as chaves dos
      // dados em vez de ORDEM_ETAPAS -- prova: trocar
      // `ORDEM_ETAPAS.forEach` por iteração sobre as chaves de
      // `alcancaram` faz este teste falhar (conversao['oferta'] passa a
      // existir).
      expect(conversao['oferta']).toBeUndefined();
    });

    it('denominador zero -- vaga sem nenhuma candidatura não recebe conversão inventada', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());
      const { conversao } = await ctx.run(tenantId, (client) =>
        service.funil(client, { tenantId, jobId: vagaSemCandidaturasId }),
      );
      // Denominador (quem alcançou triagem) é zero: não pode virar 0% nem
      // NaN, tem que ser null (sem dado, não "0% de conversão").
      expect(conversao['entrevista']).toBeNull();
    });
  });

  describe('obterMetricas', () => {
    let vagaPublicadaId: string;
    let vagaRascunhoId: string;
    let vagaNaoAtribuidaId: string;
    let recrutadorId: string;
    let personTriagemId: string;
    let personEntrevistaId: string;
    const adminId = '00000000-0000-0000-0000-000000000098';

    beforeAll(async () => {
      const vagaPublicada = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, publicado_em) VALUES ($1, $2, 'Vaga Métricas Publicada', 'vaga-metricas-publicada-0018', now()) RETURNING id`,
        [tenantId, requisitionId],
      );
      vagaPublicadaId = vagaPublicada.rows[0].id;
      const vagaRascunho = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Métricas Rascunho', 'vaga-metricas-rascunho-0018') RETURNING id`,
        [tenantId, requisitionId],
      );
      vagaRascunhoId = vagaRascunho.rows[0].id;
      const vagaNaoAtribuida = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, publicado_em) VALUES ($1, $2, 'Vaga Métricas Não Atribuída', 'vaga-metricas-nao-atribuida-0018', now()) RETURNING id`,
        [tenantId, requisitionId],
      );
      vagaNaoAtribuidaId = vagaNaoAtribuida.rows[0].id;

      const staff = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador-metricas@empresa-018.example') RETURNING id`,
        [tenantId],
      );
      recrutadorId = staff.rows[0].id;
      await adminPool.query(`INSERT INTO job_recrutador (job_id, tenant_id, staff_id) VALUES ($1, $2, $3)`, [
        vagaPublicadaId,
        tenantId,
        recrutadorId,
      ]);
      await adminPool.query(`INSERT INTO job_recrutador (job_id, tenant_id, staff_id) VALUES ($1, $2, $3)`, [
        vagaRascunhoId,
        tenantId,
        recrutadorId,
      ]);

      const person = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-metricas-001', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Dora Métricas', 'dora.metricas@example.com')
         RETURNING id`,
      );
      personTriagemId = person.rows[0].id;
      await adminPool.query(
        `INSERT INTO application (tenant_id, job_id, person_id, etapa_funil) VALUES ($1, $2, $3, 'triagem')`,
        [tenantId, vagaPublicadaId, person.rows[0].id],
      );
      const person2 = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-metricas-002', '{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}', 'Elias Métricas', 'elias.metricas@example.com')
         RETURNING id`,
      );
      personEntrevistaId = person2.rows[0].id;
      await adminPool.query(
        `INSERT INTO application (tenant_id, job_id, person_id, etapa_funil) VALUES ($1, $2, $3, 'entrevista')`,
        [tenantId, vagaNaoAtribuidaId, person2.rows[0].id],
      );
    });

    afterAll(async () => {
      await adminPool.query('DELETE FROM application WHERE job_id = ANY($1)', [
        [vagaPublicadaId, vagaNaoAtribuidaId],
      ]);
      await adminPool.query('DELETE FROM person WHERE id = ANY($1)', [
        [personTriagemId, personEntrevistaId],
      ]);
      await adminPool.query('DELETE FROM job_recrutador WHERE tenant_id = $1 AND staff_id = $2', [
        tenantId,
        recrutadorId,
      ]);
      await adminPool.query('DELETE FROM user_account WHERE id = $1', [recrutadorId]);
      await adminPool.query('DELETE FROM job WHERE id = ANY($1)', [
        [vagaPublicadaId, vagaRascunhoId, vagaNaoAtribuidaId],
      ]);
    });

    it('agrega vagas ativas/rascunho e candidaturas por estágio para admin_tenant (vê tudo)', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());

      const metricas = await ctx.run(tenantId, (client) =>
        service.obterMetricas(client, { tenantId, userId: adminId, userRoles: ['admin_tenant'] }),
      );

      expect(metricas.vagasAtivas).toBeGreaterThanOrEqual(2);
      expect(metricas.vagasRascunho).toBeGreaterThanOrEqual(1);
      expect(metricas.candidaturasEmAndamento).toBeGreaterThanOrEqual(2);
      expect(metricas.porEstagio.triagem).toBeGreaterThanOrEqual(1);
      expect(metricas.porEstagio.entrevista).toBeGreaterThanOrEqual(1);
    });

    it('agrega só as vagas atribuídas para um recrutador puro', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());

      const metricas = await ctx.run(tenantId, (client) =>
        service.obterMetricas(client, { tenantId, userId: recrutadorId, userRoles: ['recrutador'] }),
      );

      expect(metricas.vagasAtivas).toBe(1);
      expect(metricas.vagasRascunho).toBe(1);
      expect(metricas.candidaturasEmAndamento).toBe(1);
      expect(metricas.porEstagio).toEqual({ triagem: 1 });
    });
  });


  describe('editar', () => {
    it('atualiza titulo, descricao e habilidadesExigidas da vaga', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());

      const { id } = await ctx.run(tenantId, (client) =>
        service.create(client, { tenantId, requisitionId, titulo: 'Vaga a Editar' }),
      );

      await ctx.run(tenantId, (client) =>
        service.editar(client, {
          tenantId,
          jobId: id,
          titulo: 'Engenheiro de Dados Sênior',
          descricao: 'Nova descrição',
          habilidadesExigidas: ['SQL', 'Python'],
        }),
      );

      const result = await adminPool.query('SELECT titulo, descricao, habilidades_exigidas FROM job WHERE id = $1', [
        id,
      ]);
      expect(result.rows[0]).toEqual({
        titulo: 'Engenheiro de Dados Sênior',
        descricao: 'Nova descrição',
        habilidades_exigidas: ['SQL', 'Python'],
      });
    });

    it('findById retorna instrumentVersionId quando a vaga tem instrumento configurado', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());

      const { id } = await ctx.run(tenantId, (client) =>
        service.create(client, { tenantId, requisitionId, titulo: 'Vaga com Instrumento' }),
      );

      await adminPool.query(
        `INSERT INTO instrument (id, nome) VALUES ('a55e55e0-0000-4000-8000-000000000099', 'Instrumento Teste')`,
      );
      await adminPool.query(
        `INSERT INTO instrument_version (id, instrument_id, versao, ativo)
         VALUES ('a55e55e0-0000-4000-8000-000000000098', 'a55e55e0-0000-4000-8000-000000000099', 1, true)`,
      );
      await adminPool.query(`UPDATE job SET instrument_version_id = 'a55e55e0-0000-4000-8000-000000000098' WHERE id = $1`, [
        id,
      ]);

      const job = await ctx.run(tenantId, (client) => service.findById(client, { tenantId, jobId: id }));
      expect(job?.instrumentVersionId).toBe('a55e55e0-0000-4000-8000-000000000098');
    });

    it('editar atualiza instrumentVersionId da vaga', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());

      const { id } = await ctx.run(tenantId, (client) =>
        service.create(client, { tenantId, requisitionId, titulo: 'Vaga a Vincular Instrumento' }),
      );

      await adminPool.query(
        `INSERT INTO instrument (id, nome) VALUES ('a55e55e0-0000-4000-8000-0000000000a1', 'Instrumento Teste 2')`,
      );
      await adminPool.query(
        `INSERT INTO instrument_version (id, instrument_id, versao, ativo)
         VALUES ('a55e55e0-0000-4000-8000-0000000000a2', 'a55e55e0-0000-4000-8000-0000000000a1', 1, true)`,
      );

      await ctx.run(tenantId, (client) =>
        service.editar(client, {
          tenantId,
          jobId: id,
          instrumentVersionId: 'a55e55e0-0000-4000-8000-0000000000a2',
        }),
      );

      const job = await ctx.run(tenantId, (client) => service.findById(client, { tenantId, jobId: id }));
      expect(job?.instrumentVersionId).toBe('a55e55e0-0000-4000-8000-0000000000a2');
    });

    it('editar com instrumentVersionId: null desvincula o instrumento (achado da revisao final)', async () => {
      const ctx = new TenantContext(appPool);
      const service = new JobService(new RequisitionService(), new JobRecrutadorService());

      const { id } = await ctx.run(tenantId, (client) =>
        service.create(client, { tenantId, requisitionId, titulo: 'Vaga a Desvincular Instrumento' }),
      );

      await adminPool.query(
        `INSERT INTO instrument (id, nome) VALUES ('a55e55e0-0000-4000-8000-0000000000c1', 'Instrumento Teste 3')`,
      );
      await adminPool.query(
        `INSERT INTO instrument_version (id, instrument_id, versao, ativo)
         VALUES ('a55e55e0-0000-4000-8000-0000000000c2', 'a55e55e0-0000-4000-8000-0000000000c1', 1, true)`,
      );

      // Primeiro vincula um instrumento existente...
      await ctx.run(tenantId, (client) =>
        service.editar(client, {
          tenantId,
          jobId: id,
          instrumentVersionId: 'a55e55e0-0000-4000-8000-0000000000c2',
        }),
      );
      const antes = await ctx.run(tenantId, (client) => service.findById(client, { tenantId, jobId: id }));
      expect(antes?.instrumentVersionId).toBe('a55e55e0-0000-4000-8000-0000000000c2');

      // ...depois desvincula enviando null explicitamente (equivalente a
      // selecionar "Nenhum" no seletor do painel).
      await ctx.run(tenantId, (client) =>
        service.editar(client, {
          tenantId,
          jobId: id,
          instrumentVersionId: null,
        }),
      );
      const depois = await ctx.run(tenantId, (client) => service.findById(client, { tenantId, jobId: id }));
      expect(depois?.instrumentVersionId).toBeNull();
    });
  });
});

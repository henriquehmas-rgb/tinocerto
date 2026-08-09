import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { CerbosService } from '../../authz/cerbos.service';
import { CompetencyService } from '../competency.service';
import { InterviewGuideService } from '../interview-guide.service';
import { InterviewScheduleService } from '../interview-schedule.service';
import { ScorecardService, ScorecardJaSubmetidoError, AvaliadorNaoEhInterviewEvaluatorError } from '../scorecard.service';

describe('ScorecardService — visibilidade oculta até submissão própria', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);

  const cerbosService = new CerbosService(process.env.CERBOS_HTTP_URL!);
  const guideService = new InterviewGuideService(new CompetencyService());
  const scheduleService = new InterviewScheduleService();
  const scorecardService = new ScorecardService(cerbosService);

  let tenantId: string;
  let scheduleId: string;
  let avaliadorAId: string;
  let avaliadorBId: string;
  const principalRoles = ['entrevistador'];

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Scorecard Ltda','00000000000084','test-tenant-00000000000084') RETURNING id`,
    );
    tenantId = t.rows[0].id;

    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req SC', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga SC', 'vaga-sc') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-scorecard','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato SC','sc@example.com') RETURNING id`,
    );
    const application = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, job.rows[0].id, person.rows[0].id],
    );

    const avaliadorA = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'avaliadora@example.com') RETURNING id`,
      [tenantId],
    );
    const avaliadorB = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'avaliadorb@example.com') RETURNING id`,
      [tenantId],
    );
    avaliadorAId = avaliadorA.rows[0].id;
    avaliadorBId = avaliadorB.rows[0].id;

    const { id: guideId } = await tenantContext.run(tenantId, (client) =>
      guideService.criarRascunho(client, {
        tenantId,
        jobId: job.rows[0].id,
        competencias: [
          {
            nome: 'Comunicação',
            ancoras: [1, 2, 3, 4, 5].map((nivel) => ({ nivel, descricaoComportamental: `Nível ${nivel}` })),
          },
        ],
      }),
    );
    const version = await tenantContext.run(tenantId, (client) => guideService.publicar(client, tenantId, guideId));

    const schedule = await tenantContext.run(tenantId, (client) =>
      scheduleService.criar(client, {
        tenantId,
        applicationId: application.rows[0].id,
        interviewGuideVersionId: version.id,
        dataHora: new Date(),
        avaliadorIds: [avaliadorAId, avaliadorBId],
      }),
    );
    scheduleId = schedule.id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM scorecard WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_evaluator WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_schedule WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_guide_version WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_guide WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM competency WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-scorecard'`);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  // [Minor 6 da revisão final] Título anterior alegava cobrir "submetida ou
  // não", mas um scorecard sem submissão nunca existe como linha alcançável
  // por este serviço -- submeter() sempre grava submetido_em (e, após o
  // Fix 7, uma segunda submissão é rejeitada em vez de reabrir o registro).
  // Título corrigido para descrever só o que este teste de fato exercita.
  it('avaliador sempre vê a própria nota', async () => {
    await tenantContext.run(tenantId, (client) =>
      scorecardService.submeter(client, {
        tenantId,
        interviewScheduleId: scheduleId,
        avaliadorId: avaliadorAId,
        notasPorCompetencia: { comunicacao: 4 },
      }),
    );

    const visto = await tenantContext.run(tenantId, (client) =>
      scorecardService.listarPorEntrevista(client, tenantId, scheduleId, { id: avaliadorAId, roles: principalRoles }),
    );
    expect(visto.find((r) => r.avaliadorId === avaliadorAId)?.notasPorCompetencia).toEqual({ comunicacao: 4 });
  });

  it('B não vê a nota de A antes de A submeter -- espera, A já submeteu no teste anterior; aqui prova o inverso: A não vê a de B antes de B submeter', async () => {
    const vistoPorA = await tenantContext.run(tenantId, (client) =>
      scorecardService.listarPorEntrevista(client, tenantId, scheduleId, { id: avaliadorAId, roles: principalRoles }),
    );
    expect(vistoPorA.find((r) => r.avaliadorId === avaliadorBId)).toBeUndefined();
  });

  it('depois que B também submete, A vê a nota de B e B vê a de A -- visibilidade bidirecional só após ambos submeterem', async () => {
    await tenantContext.run(tenantId, (client) =>
      scorecardService.submeter(client, {
        tenantId,
        interviewScheduleId: scheduleId,
        avaliadorId: avaliadorBId,
        notasPorCompetencia: { comunicacao: 2 },
      }),
    );

    const vistoPorA = await tenantContext.run(tenantId, (client) =>
      scorecardService.listarPorEntrevista(client, tenantId, scheduleId, { id: avaliadorAId, roles: principalRoles }),
    );
    expect(vistoPorA.find((r) => r.avaliadorId === avaliadorBId)?.notasPorCompetencia).toEqual({ comunicacao: 2 });

    const vistoPorB = await tenantContext.run(tenantId, (client) =>
      scorecardService.listarPorEntrevista(client, tenantId, scheduleId, { id: avaliadorBId, roles: principalRoles }),
    );
    expect(vistoPorB.find((r) => r.avaliadorId === avaliadorAId)?.notasPorCompetencia).toEqual({ comunicacao: 4 });
  });

  it('inserir scorecard com avaliador fora de interview_evaluator é rejeitado pelo trigger', async () => {
    const intruso = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'intruso@example.com') RETURNING id`,
      [tenantId],
    );
    await expect(
      tenantContext.run(tenantId, (client) =>
        scorecardService.submeter(client, {
          tenantId,
          interviewScheduleId: scheduleId,
          avaliadorId: intruso.rows[0].id,
          notasPorCompetencia: { comunicacao: 5 },
        }),
      ),
    ).rejects.toThrow(/não está cadastrado como interview_evaluator/);
    await adminPool.query('DELETE FROM user_account WHERE id = $1', [intruso.rows[0].id]);
  });

  // [Fix round 1 -- achado incidental da revisão] A violação do trigger
  // precisa chegar tipada como AvaliadorNaoEhInterviewEvaluatorError (não
  // um Error genérico do pg) -- é essa classe que o controller usa para
  // traduzir para ForbiddenException (403) em vez do 500 cru que vazava
  // antes desta correção.
  it('inserir scorecard com avaliador fora de interview_evaluator lança AvaliadorNaoEhInterviewEvaluatorError (nao um Error generico)', async () => {
    const intruso = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'intruso2@example.com') RETURNING id`,
      [tenantId],
    );
    await expect(
      tenantContext.run(tenantId, (client) =>
        scorecardService.submeter(client, {
          tenantId,
          interviewScheduleId: scheduleId,
          avaliadorId: intruso.rows[0].id,
          notasPorCompetencia: { comunicacao: 5 },
        }),
      ),
    ).rejects.toBeInstanceOf(AvaliadorNaoEhInterviewEvaluatorError);
    await adminPool.query('DELETE FROM user_account WHERE id = $1', [intruso.rows[0].id]);
  });

  // [Fix 7 da revisão final -- decisão de produto] Scorecard imutável após
  // submissão: um segundo submeter() do MESMO avaliador para a MESMA
  // entrevista deve rejeitar com ScorecardJaSubmetidoError, e o registro
  // gravado (notas e submetido_em) deve permanecer exatamente o da
  // primeira submissão -- prova tanto a rejeição quanto que nenhuma escrita
  // silenciosa aconteceu por trás dela. Usa um avaliador isolado (E), numa
  // entrevista própria, para não interferir com o estado usado pelos
  // outros testes deste arquivo.
  it('scorecard fica imutável após submetido -- reenvio do mesmo avaliador é rejeitado e a nota original não muda', async () => {
    const avaliadorE = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'avaliadore@example.com') RETURNING id`,
      [tenantId],
    );
    const avaliadorEId = avaliadorE.rows[0].id;

    await adminPool.query(
      `INSERT INTO interview_evaluator (tenant_id, interview_schedule_id, user_id) VALUES ($1, $2, $3)`,
      [tenantId, scheduleId, avaliadorEId],
    );

    await tenantContext.run(tenantId, (client) =>
      scorecardService.submeter(client, {
        tenantId,
        interviewScheduleId: scheduleId,
        avaliadorId: avaliadorEId,
        notasPorCompetencia: { comunicacao: 5 },
        comentario: 'Nota original',
      }),
    );

    const linhaAposPrimeiraSubmissao = await adminPool.query<{ notas_por_competencia: Record<string, number>; submetido_em: string }>(
      `SELECT notas_por_competencia, submetido_em FROM scorecard WHERE tenant_id = $1 AND interview_schedule_id = $2 AND avaliador_id = $3`,
      [tenantId, scheduleId, avaliadorEId],
    );
    const submetidoEmOriginal = linhaAposPrimeiraSubmissao.rows[0].submetido_em;
    expect(linhaAposPrimeiraSubmissao.rows[0].notas_por_competencia).toEqual({ comunicacao: 5 });

    await expect(
      tenantContext.run(tenantId, (client) =>
        scorecardService.submeter(client, {
          tenantId,
          interviewScheduleId: scheduleId,
          avaliadorId: avaliadorEId,
          notasPorCompetencia: { comunicacao: 1 },
          comentario: 'Tentativa de reenvio depois de ver a nota de um colega',
        }),
      ),
    ).rejects.toThrow(ScorecardJaSubmetidoError);

    const linhaAposTentativaDeReenvio = await adminPool.query<{ notas_por_competencia: Record<string, number>; submetido_em: string }>(
      `SELECT notas_por_competencia, submetido_em FROM scorecard WHERE tenant_id = $1 AND interview_schedule_id = $2 AND avaliador_id = $3`,
      [tenantId, scheduleId, avaliadorEId],
    );
    expect(linhaAposTentativaDeReenvio.rows[0].notas_por_competencia).toEqual({ comunicacao: 5 });
    expect(linhaAposTentativaDeReenvio.rows[0].submetido_em).toEqual(submetidoEmOriginal);
  });

  // Achado da mutação do Passo 6: nenhum dos 4 testes acima de fato passa
  // pela decisão do Cerbos no caminho de NEGAÇÃO. `listarPorEntrevista`
  // pula (`continue`) qualquer avaliador sem linha em `scorecard` ANTES de
  // chamar `cerbosService.check` -- e como A sempre submete primeiro nos
  // testes acima, toda vez que B ainda não tinha submetido, B também não
  // tinha linha nenhuma (invisibilidade por ausência de dado, não por
  // política). Quando B finalmente submete (3º teste), A já havia
  // submetido a própria, então a regra 've-nota-alheia' permite dos dois
  // jeitos (política correta ou enfraquecida) -- a mutação do Passo 6 não
  // muda o resultado observável de NENHUM dos 4 testes.
  // Este teste fecha essa lacuna: usa 2 avaliadores novos na MESMA
  // entrevista e força D a submeter ANTES de C, para que C consulte a nota
  // de D já submetida enquanto a própria nota de C ainda não existe --
  // esse é o único estado em que a política correta e a enfraquecida
  // divergem de fato. Com a política revertida ele deve passar; com a
  // política do Passo 6 (condição removida) ele é o que deve falhar.
  it('C não vê a nota de D já submetida antes de C submeter a própria -- prova a negação via Cerbos, não apenas ausência de linha', async () => {
    const avaliadorC = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'avaliadorc@example.com') RETURNING id`,
      [tenantId],
    );
    const avaliadorD = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'avaliadord@example.com') RETURNING id`,
      [tenantId],
    );
    const avaliadorCId = avaliadorC.rows[0].id;
    const avaliadorDId = avaliadorD.rows[0].id;

    await adminPool.query(
      `INSERT INTO interview_evaluator (tenant_id, interview_schedule_id, user_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
      [tenantId, scheduleId, avaliadorCId, avaliadorDId],
    );

    // D submete primeiro -- a linha do scorecard de D já existe e está
    // submetida quando C (que ainda não submeteu a própria) consulta.
    await tenantContext.run(tenantId, (client) =>
      scorecardService.submeter(client, {
        tenantId,
        interviewScheduleId: scheduleId,
        avaliadorId: avaliadorDId,
        notasPorCompetencia: { comunicacao: 3 },
      }),
    );

    const vistoPorCAntes = await tenantContext.run(tenantId, (client) =>
      scorecardService.listarPorEntrevista(client, tenantId, scheduleId, { id: avaliadorCId, roles: principalRoles }),
    );
    expect(vistoPorCAntes.find((r) => r.avaliadorId === avaliadorDId)).toBeUndefined();

    await tenantContext.run(tenantId, (client) =>
      scorecardService.submeter(client, {
        tenantId,
        interviewScheduleId: scheduleId,
        avaliadorId: avaliadorCId,
        notasPorCompetencia: { comunicacao: 1 },
      }),
    );

    const vistoPorCDepois = await tenantContext.run(tenantId, (client) =>
      scorecardService.listarPorEntrevista(client, tenantId, scheduleId, { id: avaliadorCId, roles: principalRoles }),
    );
    expect(vistoPorCDepois.find((r) => r.avaliadorId === avaliadorDId)?.notasPorCompetencia).toEqual({ comunicacao: 3 });
  });

  // [Fix 4 da revisão final] Prova que a regra explícita com o guard `in`
  // em resource_scorecard.yaml é o mecanismo real negando acesso a um
  // principal que NUNCA é avaliador desta entrevista -- não apenas um
  // acidente de erro de avaliação do CEL absorvido. Um recrutador que
  // nunca foi adicionado a interview_evaluator não tem chave nenhuma em
  // submetido_por, para nenhuma linha -- a lista retornada deve ficar
  // vazia mesmo com scorecards já submetidos por A, B, C e D acima.
  it('um principal que nunca é avaliador desta entrevista (ex.: recrutador) nunca vê nenhuma linha de scorecard', async () => {
    const recrutador = await adminPool.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'recrutador-nao-avaliador@example.com') RETURNING id`,
      [tenantId],
    );

    const vistoPeloRecrutador = await tenantContext.run(tenantId, (client) =>
      scorecardService.listarPorEntrevista(client, tenantId, scheduleId, {
        id: recrutador.rows[0].id,
        roles: ['recrutador'],
      }),
    );
    expect(vistoPeloRecrutador).toEqual([]);

    await adminPool.query('DELETE FROM user_account WHERE id = $1', [recrutador.rows[0].id]);
  });
});

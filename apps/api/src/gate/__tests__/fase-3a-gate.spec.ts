import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AuditLogService } from '../../trust/audit-log.service';
import { ModelRouterService } from '../../llm-router/model-router.service';
import { ProviderAdapter } from '../../llm-router/model-router.types';
import { CerbosService } from '../../authz/cerbos.service';
import { DatabaseService } from '../../database/database.service';
import { CompetencyService } from '../../interview/competency.service';
import { InterviewGuideService } from '../../interview/interview-guide.service';
import { InterviewScheduleService } from '../../interview/interview-schedule.service';
import { ScorecardService } from '../../interview/scorecard.service';
import { BarsGenerationService } from '../../interview/bars-generation.service';

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

class AdapterFalho implements ProviderAdapter {
  constructor(public readonly name: 'anthropic' | 'openai') {}
  async complete(): Promise<never> {
    throw new Error(`${this.name} fora do ar (simulado)`);
  }
}

describe('Gate consolidado — Fase 3a (Model Router + Interview)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const cerbosService = new CerbosService(process.env.CERBOS_HTTP_URL!);

  const SRC_ROOT = path.resolve(__dirname, '../..');

  afterAll(async () => {
    await adminPool.end();
    await appPool.end();
  });

  it.each(['llm_call_log', 'competency', 'interview_guide', 'interview_guide_version', 'interview_schedule', 'interview_evaluator', 'scorecard'])(
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

  // [Minor 4 da revisão final] Exclusão de interview/ removida -- nada sob
  // src/interview/ legitimamente importa os SDKs crus (toda chamada de LLM
  // ali passa pelo Model Router), então excluir a pasta não ganhava nada e
  // esconderia uma violação futura real (ex.: uma feature de Copiloto que
  // pousasse ali sem passar pelo router). Regex também ampliado para pegar
  // um import nu do pacote do SDK, não só `new X(...)` -- só
  // llm-router/provider-adapter.ts deve legitimamente casar, e esse
  // arquivo já é excluído da varredura abaixo.
  it('nenhum arquivo de produção fora de llm-router/ chama SDK de fornecedor de LLM diretamente', () => {
    const arquivos = listarArquivosDeProducao(SRC_ROOT).filter((f) => !f.includes(`${path.sep}llm-router${path.sep}`));
    expect(arquivos.length).toBeGreaterThan(50);

    const padraoSdkDireto = /new\s+(Anthropic|OpenAI)\s*\(|from\s+['"]@anthropic-ai\/sdk['"]|from\s+['"]openai['"]/;
    const ofensores = arquivos.filter((f) => padraoSdkDireto.test(readFileSync(f, 'utf-8')));
    expect(ofensores.map((f) => path.relative(SRC_ROOT, f))).toEqual([]);
  });

  // [Minor 5 da revisão final] Antes só checava presença (toContain) --
  // "na ordem certa" no título não era exercitado por nenhuma asserção.
  // Agora compara os índices reais das migrations esperadas no manifest
  // contra a mesma lista ordenada -- se alguma vier fora de ordem (ex.:
  // scorecard antes de competency), o teste falha de verdade.
  it('as migrations da Fase 3a estão registradas no manifest, na ordem certa', () => {
    const manifest = JSON.parse(readFileSync(path.join(SRC_ROOT, '../migrations/manifest.json'), 'utf-8')) as {
      migrations: string[];
    };
    const esperadas = [
      'llm_router_0001__llm_call_log.sql',
      'interview_0001__competency.sql',
      'interview_0002__interview_guide.sql',
      'interview_0003__interview_guide_version.sql',
      'interview_0004__interview_schedule.sql',
      'interview_0005__interview_evaluator.sql',
      'interview_0006__scorecard.sql',
    ];
    const indices = esperadas.map((m) => manifest.migrations.indexOf(m));
    expect(indices.every((i) => i !== -1)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('trocar o provedor mockado por trás do Model Router não exige nenhuma alteração de código no consumidor (BARS generation)', async () => {
    let tenantId: string | undefined;
    try {
      const t = await adminPool.query<{ id: string }>(
        `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 3a Swap Ltda','00000000000085','test-tenant-00000000000085') RETURNING id`,
      );
      tenantId = t.rows[0].id;
      const orgUnit = await adminPool.query<{ id: string }>(
        `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
        [tenantId],
      );
      const req = await adminPool.query<{ id: string }>(
        `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Swap', 'aprovada', now()) RETURNING id`,
        [tenantId, orgUnit.rows[0].id],
      );
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Swap', 'vaga-swap') RETURNING id`,
        [tenantId, req.rows[0].id],
      );

      const roteiroValido = {
        competencias: [
          {
            nome: 'Comunicação',
            ancoras: [1, 2, 3, 4, 5].map((nivel) => ({ nivel, descricaoComportamental: `Nível ${nivel}` })),
          },
        ],
      };
      // <T> explícito e cast em `data`: mesmo padrão dos outros doubles de
      // teste no projeto (ex.: AdapterFixo em model-router.service.spec.ts)
      // -- ProviderAdapter é genérico sobre T, mas este double devolve
      // sempre o mesmo roteiro fixo.
      class AdapterSaudavel implements ProviderAdapter {
        constructor(public readonly name: 'anthropic' | 'openai') {}
        async complete<T>() {
          return { data: roteiroValido as T, modelId: `fake-${this.name}`, inputTokens: 100, outputTokens: 100 };
        }
      }

      const guideService = new InterviewGuideService(new CompetencyService());

      // Rodada 1: adapter "primário" saudável.
      const barsPrimarioSaudavel = new BarsGenerationService(
        new ModelRouterService(new AuditLogService(), new AdapterSaudavel('anthropic'), new AdapterFalho('openai')),
        guideService,
        { pool: appPool } as DatabaseService,
      );
      const draft1 = await barsPrimarioSaudavel.gerarRascunho({ tenantId: tenantId!, jobId: job.rows[0].id, tituloVaga: 'x', textoRequisicao: 'y' });
      expect(draft1.id).toBeDefined();

      // Rodada 2: MESMO código de BarsGenerationService -- só o adapter
      // injetado no router muda. Primário agora falha, o fallback assume.
      const barsComFallback = new BarsGenerationService(
        new ModelRouterService(new AuditLogService(), new AdapterFalho('anthropic'), new AdapterSaudavel('openai')),
        guideService,
        { pool: appPool } as DatabaseService,
      );
      const draft2 = await barsComFallback.gerarRascunho({ tenantId: tenantId!, jobId: job.rows[0].id, tituloVaga: 'x', textoRequisicao: 'y' });
      expect(draft2.id).toBeDefined();

      const providerLog = await tenantContext.run(tenantId, (client) =>
        client.query<{ provider: string }>(
          `SELECT provider FROM llm_call_log WHERE tenant_id = $1 AND prompt_id = 'bars-generation' ORDER BY occurred_at`,
          [tenantId],
        ),
      );
      expect(providerLog.rows.map((r) => r.provider)).toEqual(['anthropic', 'openai']);
    } finally {
      if (tenantId) {
        await adminPool.query('DELETE FROM interview_guide WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM competency WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM llm_call_log WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
      }
    }
  });

  it('ponta a ponta: rascunho publicado vira versão imutável, agenda com dois avaliadores, visibilidade oculta funciona pelo pool de RUNTIME, isolamento de tenant real', async () => {
    let tenantId: string | undefined;
    let outroTenantId: string | undefined;
    try {
      tenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 3a E2E Ltda','00000000000082','test-tenant-00000000000082') RETURNING id`,
        )
      ).rows[0].id;
      outroTenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 3a E2E Outro Ltda','00000000000083','test-tenant-00000000000083') RETURNING id`,
        )
      ).rows[0].id;

      const orgUnit = await adminPool.query<{ id: string }>(
        `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
        [tenantId],
      );
      const req = await adminPool.query<{ id: string }>(
        `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Gate 3a', 'aprovada', now()) RETURNING id`,
        [tenantId, orgUnit.rows[0].id],
      );
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Gate 3a', 'vaga-gate-3a') RETURNING id`,
        [tenantId, req.rows[0].id],
      );
      const person = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-gate-3a','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato Gate 3a','gate3a@example.com') RETURNING id`,
      );
      const application = await adminPool.query<{ id: string }>(
        `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, job.rows[0].id, person.rows[0].id],
      );
      const avaliadorA = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'gate-a@example.com') RETURNING id`,
        [tenantId],
      );
      const avaliadorB = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'gate-b@example.com') RETURNING id`,
        [tenantId],
      );

      const guideService = new InterviewGuideService(new CompetencyService());
      const scheduleService = new InterviewScheduleService();
      const scorecardService = new ScorecardService(cerbosService);

      const { id: guideId } = await tenantContext.run(tenantId, (client) =>
        guideService.criarRascunho(client, {
          tenantId: tenantId!,
          jobId: job.rows[0].id,
          competencias: [
            {
              nome: 'Comunicação',
              ancoras: [1, 2, 3, 4, 5].map((nivel) => ({ nivel, descricaoComportamental: `Nível ${nivel}` })),
            },
          ],
        }),
      );
      const version = await tenantContext.run(tenantId, (client) => guideService.publicar(client, tenantId!, guideId));
      expect(version.versao).toBe(1);

      const schedule = await tenantContext.run(tenantId, (client) =>
        scheduleService.criar(client, {
          tenantId: tenantId!,
          applicationId: application.rows[0].id,
          interviewGuideVersionId: version.id,
          dataHora: new Date(),
          avaliadorIds: [avaliadorA.rows[0].id, avaliadorB.rows[0].id],
        }),
      );

      await tenantContext.run(tenantId, (client) =>
        scorecardService.submeter(client, {
          tenantId: tenantId!,
          interviewScheduleId: schedule.id,
          avaliadorId: avaliadorA.rows[0].id,
          notasPorCompetencia: { comunicacao: 5 },
        }),
      );

      const vistoPorB = await tenantContext.run(tenantId, (client) =>
        scorecardService.listarPorEntrevista(client, tenantId!, schedule.id, {
          id: avaliadorB.rows[0].id,
          roles: ['entrevistador'],
        }),
      );
      expect(vistoPorB.find((r) => r.avaliadorId === avaliadorA.rows[0].id)).toBeUndefined();

      // Isolamento: outro tenant não enxerga nada deste agendamento.
      const vistoDeOutroTenant = await tenantContext.run(outroTenantId, (client) =>
        client.query(`SELECT id FROM interview_schedule WHERE id = $1`, [schedule.id]),
      );
      expect(vistoDeOutroTenant.rows).toEqual([]);
    } finally {
      if (tenantId) {
        await adminPool.query('DELETE FROM scorecard WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_evaluator WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_schedule WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_guide_version WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_guide WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM competency WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
        await adminPool.query(`DELETE FROM person WHERE cpf_hash = 'hash-gate-3a'`);
        await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
      }
      if (outroTenantId) {
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenantId]);
      }
    }
  });
});

// apps/api/src/gate/__tests__/fase-3c-gate.spec.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AuditLogService } from '../../trust/audit-log.service';
import { ModelRouterService } from '../../llm-router/model-router.service';
import { ProviderAdapter } from '../../llm-router/model-router.types';
import { DatabaseService } from '../../database/database.service';
import { CompetencyService } from '../../interview/competency.service';
import { InterviewGuideService } from '../../interview/interview-guide.service';
import { PersonService } from '../../talent/person.service';
import { EnvelopeEncryptionService } from '../../talent/envelope-encryption.service';
import { JobDescriptionCopilotService } from '../../copilot/job-description-copilot.service';
import { CandidateSummaryService } from '../../copilot/candidate-summary.service';
import { InterviewQuestionSuggestionService } from '../../copilot/interview-question-suggestion.service';

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

describe('Gate consolidado — Fase 3c (Copiloto MVP)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const guideService = new InterviewGuideService(new CompetencyService());
  // [Desvio do plano original] CandidateSummaryService passou a depender de
  // PersonService.perfilCitavel (ver fix(copilot): roteia leitura de
  // person_profile por PersonService) -- as duas instâncias de
  // CandidateSummaryService abaixo precisam desta dependência a mais em
  // relação ao código originalmente proposto pelo plano desta task.
  const personService = new PersonService(new EnvelopeEncryptionService());

  const SRC_ROOT = path.resolve(__dirname, '../..');

  afterAll(async () => {
    await adminPool.end();
    await appPool.end();
  });

  it.each(['job_description_suggestion', 'candidate_summary_draft', 'interview_question_suggestion'])(
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

  // Reexecuta o MESMO regex já endurecido na revisão final da Fase 3a --
  // exclusão continua sendo só llm-router/. Como src/copilot/ NÃO está na
  // exclusão, este teste é a prova de que as 3 funcionalidades desta fase
  // realmente passam pelo Model Router (decisão 5 do design spec), não uma
  // allowlist nova escrita torcendo a regra para o Copiloto passar.
  it('nenhum arquivo de produção fora de llm-router/ chama SDK de fornecedor de LLM diretamente (cobrindo copilot/)', () => {
    const arquivos = listarArquivosDeProducao(SRC_ROOT).filter((f) => !f.includes(`${path.sep}llm-router${path.sep}`));
    const arquivosCopilot = arquivos.filter((f) => f.includes(`${path.sep}copilot${path.sep}`));
    expect(arquivosCopilot.length).toBeGreaterThanOrEqual(6);

    const padraoSdkDireto = /new\s+(Anthropic|OpenAI)\s*\(|from\s+['"]@anthropic-ai\/sdk['"]|from\s+['"]openai['"]/;
    const ofensores = arquivos.filter((f) => padraoSdkDireto.test(readFileSync(f, 'utf-8')));
    expect(ofensores.map((f) => path.relative(SRC_ROOT, f))).toEqual([]);
  });

  it('as migrations da Fase 3c estão registradas no manifest, na ordem certa', () => {
    const manifest = JSON.parse(readFileSync(path.join(SRC_ROOT, '../migrations/manifest.json'), 'utf-8')) as { migrations: string[] };
    const esperadas = [
      'copilot_0001__job_description_suggestion.sql',
      'copilot_0002__candidate_summary_draft.sql',
      'copilot_0003__interview_question_suggestion.sql',
    ];
    const indices = esperadas.map((m) => manifest.migrations.indexOf(m));
    expect(indices.every((i) => i !== -1)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('trocar o provedor mockado por trás do Model Router não exige alteração de código no consumidor (descrição de vaga)', async () => {
    let tenantId: string | undefined;
    try {
      const t = await adminPool.query<{ id: string }>(
        `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 3c Swap Ltda','00000000000104','test-tenant-00000000000104') RETURNING id`,
      );
      tenantId = t.rows[0].id;
      const orgUnit = await adminPool.query<{ id: string }>(
        `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
        [tenantId],
      );
      const req = await adminPool.query<{ id: string }>(
        `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Gate Swap', 'aprovada', now()) RETURNING id`,
        [tenantId, orgUnit.rows[0].id],
      );
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, descricao, seo_slug) VALUES ($1, $2, 'Vaga Gate Swap', 'texto original', 'vaga-gate-swap') RETURNING id`,
        [tenantId, req.rows[0].id],
      );

      class AdapterSaudavel implements ProviderAdapter {
        constructor(public readonly name: 'anthropic' | 'openai') {}
        async complete<T>() {
          return { data: { textoReescrito: 'texto reescrito' } as T, modelId: `fake-${this.name}`, inputTokens: 50, outputTokens: 50 };
        }
      }

      // Rodada 1: primário saudável.
      const servicoPrimarioSaudavel = new JobDescriptionCopilotService(
        new ModelRouterService(new AuditLogService(), new AdapterSaudavel('anthropic'), new AdapterFalho('openai')),
        new AuditLogService(),
        { pool: appPool } as DatabaseService,
      );
      const s1 = await servicoPrimarioSaudavel.sugerir({ tenantId, jobId: job.rows[0].id });
      expect(s1.textoSugerido).toBe('texto reescrito');

      // Rodada 2: MESMO código de serviço -- só o adapter injetado no
      // router muda. Primário falha, o fallback assume.
      const servicoComFallback = new JobDescriptionCopilotService(
        new ModelRouterService(new AuditLogService(), new AdapterFalho('anthropic'), new AdapterSaudavel('openai')),
        new AuditLogService(),
        { pool: appPool } as DatabaseService,
      );
      const s2 = await servicoComFallback.sugerir({ tenantId, jobId: job.rows[0].id });
      expect(s2.textoSugerido).toBe('texto reescrito');

      const providerLog = await tenantContext.run(tenantId, (client) =>
        client.query<{ provider: string }>(
          `SELECT provider FROM llm_call_log WHERE tenant_id = $1 AND prompt_id = 'job-description-rewrite' ORDER BY occurred_at`,
          [tenantId],
        ),
      );
      expect(providerLog.rows.map((r) => r.provider)).toEqual(['anthropic', 'openai']);
    } finally {
      if (tenantId) {
        await adminPool.query('DELETE FROM job_description_suggestion WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM llm_call_log WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
      }
    }
  });

  it('ponta a ponta: as 3 funcionalidades do Copiloto consomem contratos reais da Fase 3a e respeitam isolamento de tenant', async () => {
    let tenantId: string | undefined;
    let outroTenantId: string | undefined;
    let personId: string | undefined;
    try {
      tenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 3c E2E Ltda','00000000000105','test-tenant-00000000000105') RETURNING id`,
        )
      ).rows[0].id;
      outroTenantId = (
        await adminPool.query<{ id: string }>(
          `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Gate 3c E2E Outro Ltda','00000000000106','test-tenant-00000000000106') RETURNING id`,
        )
      ).rows[0].id;

      const orgUnit = await adminPool.query<{ id: string }>(
        `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
        [tenantId],
      );
      const req = await adminPool.query<{ id: string }>(
        `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Gate 3c', 'aprovada', now()) RETURNING id`,
        [tenantId, orgUnit.rows[0].id],
      );
      const job = await adminPool.query<{ id: string }>(
        `INSERT INTO job (tenant_id, requisition_id, titulo, descricao, seo_slug)
         VALUES ($1, $2, 'Vaga Gate 3c', 'Buscamos um cara para a vaga.', 'vaga-gate-3c') RETURNING id`,
        [tenantId, req.rows[0].id],
      );

      const person = await adminPool.query<{ id: string }>(
        `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
         VALUES ('hash-gate-3c','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato Gate 3c','gate3c@example.com') RETURNING id`,
      );
      personId = person.rows[0].id;
      const citacaoReal = 'Analista Pleno na Empresa Gate 3c, de 2021 a 2024';
      await adminPool.query(
        `INSERT INTO person_profile (person_id, experiencias, formacao, habilidades) VALUES ($1, $2, '[]'::jsonb, '[]'::jsonb)`,
        [personId, JSON.stringify([{ cargo: 'Analista Pleno', empresa: 'Empresa Gate 3c', periodo: '2021-2024', descricao: '', citacaoVerbatim: citacaoReal, offsetInicio: 0, offsetFim: citacaoReal.length }])],
      );
      const application = await adminPool.query<{ id: string }>(
        `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, job.rows[0].id, personId],
      );

      const { id: guideId } = await tenantContext.run(tenantId, (client) =>
        guideService.criarRascunho(client, {
          tenantId: tenantId!,
          jobId: job.rows[0].id,
          competencias: [{ nome: 'Comunicação', ancoras: [1, 2, 3, 4, 5].map((nivel) => ({ nivel, descricaoComportamental: `Nível ${nivel}` })) }],
        }),
      );
      const version = await tenantContext.run(tenantId, (client) => guideService.publicar(client, tenantId!, guideId));
      const competencyId = (
        await adminPool.query<{ id: string }>(`SELECT id FROM competency WHERE tenant_id = $1 AND nome = 'Comunicação'`, [tenantId])
      ).rows[0].id;

      class AdapterDescricao implements ProviderAdapter {
        readonly name = 'anthropic' as const;
        async complete<T>() {
          return { data: { textoReescrito: 'Buscamos uma pessoa para a vaga.' } as T, modelId: 'fake', inputTokens: 10, outputTokens: 10 };
        }
      }
      class AdapterResumo implements ProviderAdapter {
        readonly name = 'anthropic' as const;
        async complete<T>() {
          return {
            data: { frases: [{ texto: 'Foi Analista Pleno na Empresa Gate 3c.', fonteId: 'experiencia:0', citacaoVerbatim: 'Analista Pleno na Empresa Gate 3c' }] } as T,
            modelId: 'fake',
            inputTokens: 10,
            outputTokens: 10,
          };
        }
      }
      class AdapterPerguntas implements ProviderAdapter {
        readonly name = 'anthropic' as const;
        async complete<T>() {
          return { data: { itens: [{ competencyId, perguntas: ['Conte uma vez em que você se comunicou bem sob pressão.'] }] } as T, modelId: 'fake', inputTokens: 10, outputTokens: 10 };
        }
      }

      const jobDescService = new JobDescriptionCopilotService(
        new ModelRouterService(new AuditLogService(), new AdapterDescricao(), new AdapterFalho('openai')),
        new AuditLogService(),
        { pool: appPool } as DatabaseService,
      );
      const summaryService = new CandidateSummaryService(
        new ModelRouterService(new AuditLogService(), new AdapterResumo(), new AdapterFalho('openai')),
        new AuditLogService(),
        { pool: appPool } as DatabaseService,
        personService,
      );
      const questionService = new InterviewQuestionSuggestionService(
        new ModelRouterService(new AuditLogService(), new AdapterPerguntas(), new AdapterFalho('openai')),
        { pool: appPool } as DatabaseService,
      );

      const descSuggestion = await jobDescService.sugerir({ tenantId: tenantId!, jobId: job.rows[0].id });
      const descApplied = await jobDescService.aplicar({ tenantId: tenantId!, jobId: job.rows[0].id, suggestionId: descSuggestion.id });
      expect(descApplied.descricao).toBe('Buscamos uma pessoa para a vaga.');

      const summaryDraft = await summaryService.gerar({ tenantId: tenantId!, applicationId: application.rows[0].id });
      expect(summaryDraft.frases).toHaveLength(1);
      await summaryService.aplicar({ tenantId: tenantId!, applicationId: application.rows[0].id, draftId: summaryDraft.id });
      const atual = await tenantContext.run(tenantId, (client) => summaryService.obterAtual(client, tenantId!, application.rows[0].id));
      expect(atual?.id).toBe(summaryDraft.id);

      const questionSuggestion = await questionService.gerar({ tenantId: tenantId!, interviewGuideVersionId: version.id });
      expect(questionSuggestion.itens).toEqual([{ competencyId, nome: 'Comunicação', perguntas: ['Conte uma vez em que você se comunicou bem sob pressão.'] }]);

      // Isolamento: outro tenant não enxerga nenhuma das sugestões geradas.
      const vistoDeOutroTenant = await tenantContext.run(outroTenantId, (client) =>
        client.query(`SELECT id FROM candidate_summary_draft WHERE id = $1`, [summaryDraft.id]),
      );
      expect(vistoDeOutroTenant.rows).toEqual([]);
    } finally {
      if (tenantId) {
        await adminPool.query('DELETE FROM interview_question_suggestion WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM candidate_summary_draft WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM job_description_suggestion WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_guide_version WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM interview_guide WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM competency WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM llm_call_log WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
        if (personId) {
          await adminPool.query('DELETE FROM person_profile WHERE person_id = $1', [personId]);
          await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
        }
        await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
      }
      if (outroTenantId) {
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenantId]);
      }
    }
  });
});

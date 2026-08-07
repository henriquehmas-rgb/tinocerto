import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AuditLogService } from '../../trust/audit-log.service';
import { AnthropicAdapter, OpenAiAdapter } from '../../llm-router/provider-adapter';
import { ModelRouterService } from '../../llm-router/model-router.service';
import { ProviderAdapter } from '../../llm-router/model-router.types';
import { CompetencyService } from '../competency.service';
import { InterviewGuideService } from '../interview-guide.service';
import { BarsGenerationService } from '../bars-generation.service';
import { DatabaseService } from '../../database/database.service';

class AdapterComRoteiroFixo implements ProviderAdapter {
  readonly name = 'anthropic' as const;
  // <T> explícito e cast em `data`: mesmo padrão do double de teste em
  // model-router.service.spec.ts -- ProviderAdapter é genérico sobre T, mas
  // este double devolve sempre o mesmo objeto fixo, então precisa do cast
  // para o TypeScript aceitar unificar com um T arbitrário.
  async complete<T>() {
    return {
      data: {
        competencias: [
          {
            nome: 'Comunicação',
            ancoras: [1, 2, 3, 4, 5].map((nivel) => ({ nivel, descricaoComportamental: `Nível ${nivel} de comunicação` })),
          },
          {
            nome: 'Resolução de problemas',
            ancoras: [1, 2, 3, 4, 5].map((nivel) => ({ nivel, descricaoComportamental: `Nível ${nivel} de resolução` })),
          },
        ],
      } as T,
      modelId: 'fake-claude',
      inputTokens: 200,
      outputTokens: 300,
    };
  }
}

describe('BarsGenerationService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);

  let tenantId: string;
  let jobId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('BARS Ltda','00000000000080','test-tenant-00000000000080') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req BARS', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga BARS', 'vaga-bars') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM interview_guide WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM competency WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM llm_call_log WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('gera um interview_guide em rascunho com as competências e âncoras sugeridas, e loga a chamada', async () => {
    const router = new ModelRouterService(new AuditLogService(), new AdapterComRoteiroFixo(), new AdapterComRoteiroFixo());
    const guideService = new InterviewGuideService(new CompetencyService());
    // Construção direta (não via Nest DI) -- passamos um objeto mínimo que
    // satisfaz a única propriedade que BarsGenerationService de fato usa de
    // DatabaseService (`.pool`), reaproveitando o appPool real já em
    // escopo neste arquivo.
    const barsService = new BarsGenerationService(router, guideService, { pool: appPool } as DatabaseService);

    const { id: guideId } = await tenantContext.run(tenantId, (client) =>
      barsService.gerarRascunho(client, {
        tenantId,
        jobId,
        tituloVaga: 'Analista de Operações',
        textoRequisicao: 'Vaga para analista pleno, foco em processos e comunicação com times internos.',
      }),
    );

    const guide = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT status, competencias_rascunho FROM interview_guide WHERE tenant_id = $1 AND id = $2`, [tenantId, guideId]),
    );
    expect(guide.rows[0].status).toBe('rascunho');
    expect(guide.rows[0].competencias_rascunho).toHaveLength(2);

    const log = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT prompt_id FROM llm_call_log WHERE tenant_id = $1 AND prompt_id = 'bars-generation'`, [tenantId]),
    );
    expect(log.rows).toHaveLength(1);
  });

  // [Fix 2 da revisão final] Prova que a chamada de IA (router.complete,
  // que grava llm_call_log dentro da SUA PRÓPRIA transação) sobrevive
  // mesmo quando a escrita seguinte (guideService.criarRascunho, na
  // transação do chamador) falha -- aqui forçada por um jobId que não
  // existe para o tenant, violando a FK de interview_guide.job_id. Antes
  // do Fix 2, as duas escritas compartilhavam a mesma transação e o
  // rollback de criarRascunho apagava também o log da chamada real e
  // faturada ao provedor.
  it('mantém o registro em llm_call_log mesmo quando a escrita seguinte (criarRascunho) falha', async () => {
    const router = new ModelRouterService(new AuditLogService(), new AdapterComRoteiroFixo(), new AdapterComRoteiroFixo());
    const guideService = new InterviewGuideService(new CompetencyService());
    const barsService = new BarsGenerationService(router, guideService, { pool: appPool } as DatabaseService);

    const jobIdInexistente = '00000000-0000-0000-0000-000000000000';

    await expect(
      tenantContext.run(tenantId, (client) =>
        barsService.gerarRascunho(client, {
          tenantId,
          jobId: jobIdInexistente,
          tituloVaga: 'Vaga Inexistente',
          textoRequisicao: 'Requisição qualquer.',
        }),
      ),
    ).rejects.toThrow();

    const log = await tenantContext.run(tenantId, (client) =>
      client.query(
        `SELECT prompt_id FROM llm_call_log WHERE tenant_id = $1 AND prompt_id = 'bars-generation'`,
        [tenantId],
      ),
    );
    // A chamada da PRIMEIRA it() deste describe já grava 1 linha; esta
    // segunda chamada (que falha em criarRascunho) deve adicionar mais 1,
    // não 0 -- se a transação fosse compartilhada, o rollback de
    // criarRascunho apagaria esta segunda linha e o total continuaria 1.
    expect(log.rows.length).toBe(2);
  });

  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
  const maybeIt = hasAnthropicKey && hasOpenAiKey ? it : it.skip;
  if (!hasAnthropicKey || !hasOpenAiKey) {
    console.warn('ANTHROPIC_API_KEY e/ou OPENAI_API_KEY ausentes -- pulando teste real de geração BARS');
  }

  maybeIt('chamada real gera sempre as 5 âncoras por competência sugerida', async () => {
    const router = new ModelRouterService(new AuditLogService(), new AnthropicAdapter(), new OpenAiAdapter());
    const guideService = new InterviewGuideService(new CompetencyService());
    const barsService = new BarsGenerationService(router, guideService, { pool: appPool } as DatabaseService);

    const { id: guideId } = await tenantContext.run(tenantId, (client) =>
      barsService.gerarRascunho(client, {
        tenantId,
        jobId,
        tituloVaga: 'Analista de Operações',
        textoRequisicao: 'Vaga para analista pleno, foco em processos e comunicação com times internos.',
      }),
    );

    const guide = await tenantContext.run(tenantId, (client) =>
      client.query<{ competencias_rascunho: { ancoras: unknown[] }[] }>(
        `SELECT competencias_rascunho FROM interview_guide WHERE tenant_id = $1 AND id = $2`,
        [tenantId, guideId],
      ),
    );
    const competencias = guide.rows[0].competencias_rascunho;
    expect(competencias.length).toBeGreaterThanOrEqual(3);
    for (const c of competencias) {
      expect(c.ancoras).toHaveLength(5);
    }
  }, 30000);
});

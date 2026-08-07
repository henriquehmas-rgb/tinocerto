// apps/api/src/copilot/__tests__/interview-question-suggestion.service.spec.ts
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AuditLogService } from '../../trust/audit-log.service';
import { ModelRouterService } from '../../llm-router/model-router.service';
import { ModelRouterUnavailableError, ProviderAdapter } from '../../llm-router/model-router.types';
import { DatabaseService } from '../../database/database.service';
import { CompetencyService } from '../../interview/competency.service';
import { InterviewGuideService } from '../../interview/interview-guide.service';
import { InterviewGuideVersionNotFoundError, InterviewQuestionSuggestionService } from '../interview-question-suggestion.service';

class AdapterComItensFixos implements ProviderAdapter {
  readonly name = 'anthropic' as const;
  constructor(private readonly itens: { competencyId: string; perguntas: string[] }[]) {}
  async complete<T>() {
    return { data: { itens: this.itens } as T, modelId: 'fake-claude', inputTokens: 100, outputTokens: 100 };
  }
}

describe('InterviewQuestionSuggestionService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const guideService = new InterviewGuideService(new CompetencyService());

  let tenantId: string;
  let versionId: string;
  let competencyId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Copilot Interview Questions Ltda','00000000000103','test-tenant-00000000000103') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Copilot Perguntas', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Copilot Perguntas', 'vaga-copilot-perguntas') RETURNING id`,
      [tenantId, req.rows[0].id],
    );

    const { id: guideId } = await tenantContext.run(tenantId, (client) =>
      guideService.criarRascunho(client, {
        tenantId,
        jobId: job.rows[0].id,
        competencias: [
          { nome: 'Comunicação', ancoras: [1, 2, 3, 4, 5].map((nivel) => ({ nivel, descricaoComportamental: `Nível ${nivel} de comunicação` })) },
        ],
      }),
    );
    const version = await tenantContext.run(tenantId, (client) => guideService.publicar(client, tenantId, guideId));
    versionId = version.id;

    const competency = await adminPool.query<{ id: string }>(`SELECT id FROM competency WHERE tenant_id = $1 AND nome = 'Comunicação'`, [tenantId]);
    competencyId = competency.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM interview_question_suggestion WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_guide_version WHERE tenant_id = $1', [tenantId]);
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

  it('gera perguntas cobrindo 1:1 as competências do snapshot e persiste', async () => {
    const router = new ModelRouterService(
      new AuditLogService(),
      new AdapterComItensFixos([{ competencyId, perguntas: ['Conte uma situação em que você precisou explicar algo complexo para alguém leigo.'] }]),
      new AdapterComItensFixos([]),
    );
    const service = new InterviewQuestionSuggestionService(router, { pool: appPool } as DatabaseService);

    const suggestion = await service.gerar({ tenantId, interviewGuideVersionId: versionId });
    expect(suggestion.itens).toHaveLength(1);
    expect(suggestion.itens[0].competencyId).toBe(competencyId);
    expect(suggestion.itens[0].nome).toBe('Comunicação');

    const listed = await tenantContext.run(tenantId, (client) => service.listar(client, tenantId, versionId));
    expect(listed).toHaveLength(1);
  });

  // Prova de mutação equivalente à das 5 âncoras do BARS (Fase 3a): saída
  // que inventa uma competência fora do snapshot precisa ser rejeitada
  // pelo próprio schema.parse do router (aciona fallback; como o fallback
  // também é inválido aqui, o resultado final é ModelRouterUnavailableError).
  it('rejeita saída que inventa competência fora do snapshot -- schema.parse falha nos dois fornecedores', async () => {
    const router = new ModelRouterService(
      new AuditLogService(),
      new AdapterComItensFixos([{ competencyId: 'competencia-inventada-fora-do-snapshot', perguntas: ['pergunta qualquer'] }]),
      new AdapterComItensFixos([{ competencyId: 'competencia-inventada-fora-do-snapshot', perguntas: ['pergunta qualquer'] }]),
    );
    const service = new InterviewQuestionSuggestionService(router, { pool: appPool } as DatabaseService);

    await expect(service.gerar({ tenantId, interviewGuideVersionId: versionId })).rejects.toBeInstanceOf(ModelRouterUnavailableError);
  });

  it('rejeita interview_guide_version inexistente no tenant sem chamar o router', async () => {
    const router = new ModelRouterService(new AuditLogService(), new AdapterComItensFixos([]), new AdapterComItensFixos([]));
    const service = new InterviewQuestionSuggestionService(router, { pool: appPool } as DatabaseService);
    await expect(
      service.gerar({ tenantId, interviewGuideVersionId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toBeInstanceOf(InterviewGuideVersionNotFoundError);
  });
});

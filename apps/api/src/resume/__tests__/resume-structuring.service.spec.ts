import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AuditLogService } from '../../trust/audit-log.service';
import { AnthropicAdapter, OpenAiAdapter } from '../../llm-router/provider-adapter';
import { ModelRouterService } from '../../llm-router/model-router.service';
import { ProviderAdapter } from '../../llm-router/model-router.types';
import { ResumeStructuringService, StructuredResume } from '../resume-structuring.service';
import { locateVerbatimOffset } from '../locate-verbatim-offset';

// [Fix 6 da revisão final] Fixture com um `citacaoVerbatim` bem
// identificável -- usado para provar que essa string NÃO chega em
// llm_call_log.output_summary quando o summarizer estrutural é aplicado.
const CV_FIXO: StructuredResume = {
  experiencias: [
    {
      cargo: 'Analista',
      empresa: 'Empresa Fixture',
      periodo: '2020-2023',
      descricao: 'Descrição fixa',
      citacaoVerbatim: 'CITACAO_VERBATIM_SENTINELA_EXPERIENCIA',
    },
  ],
  formacao: [
    {
      curso: 'Curso Fixture',
      instituicao: 'Instituição Fixture',
      periodo: '2016-2019',
      citacaoVerbatim: 'CITACAO_VERBATIM_SENTINELA_FORMACAO',
    },
  ],
  habilidades: [{ nome: 'Habilidade Fixture', citacaoVerbatim: 'CITACAO_VERBATIM_SENTINELA_HABILIDADE' }],
};

class AdapterComCvFixo implements ProviderAdapter {
  readonly name = 'anthropic' as const;
  // <T> explícito e cast em `data`: mesmo padrão dos outros doubles de
  // teste no projeto -- ProviderAdapter é genérico sobre T, mas este
  // double devolve sempre o mesmo CV fixo.
  async complete<T>() {
    return { data: CV_FIXO as T, modelId: 'fake-claude', inputTokens: 50, outputTokens: 80 };
  }
}

const TEXTO_CURRICULO = `
CARLOS EDUARDO LIMA

EXPERIÊNCIA PROFISSIONAL
Analista de Operações Pleno na Empresa Exemplo Ltda, de janeiro de 2020 a março de 2023.
Responsável por otimização de processos logísticos e gestão de equipe de 5 pessoas.

FORMAÇÃO
Bacharelado em Administração pela Universidade Federal Exemplo, concluído em 2019.

HABILIDADES
Excel avançado, gestão de projetos, liderança de equipes.
`.trim();

describe('ResumeStructuringService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Resume Router Ltda','00000000000077','test-tenant-00000000000077') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM llm_call_log WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  // [Fix 6 da revisão final] Teste determinístico com adapter fixo -- prova
  // que o summarizer estrutural passado a `logOutputAs` é de fato invocado
  // e que é o RESULTADO dele (não o CV bruto) que fica em
  // llm_call_log.output_summary. Não depende de chave de API real.
  it('grava apenas contagens estruturais em output_summary, nunca o CV bruto ou citações verbatim', async () => {
    const router = new ModelRouterService(new AuditLogService(), new AdapterComCvFixo(), new AdapterComCvFixo());
    const service = new ResumeStructuringService(router);

    await tenantContext.run(tenantId, (client) => service.structure(client, tenantId, TEXTO_CURRICULO));

    const logRows = await tenantContext.run(tenantId, (client) =>
      client.query<{ output_summary: unknown }>(
        `SELECT output_summary FROM llm_call_log WHERE tenant_id = $1 AND prompt_id = 'resume-parsing'`,
        [tenantId],
      ),
    );
    expect(logRows.rows).toHaveLength(1);
    expect(logRows.rows[0].output_summary).toEqual({
      experienciasCount: 1,
      formacaoCount: 1,
      habilidadesCount: 1,
    });
    const summaryString = JSON.stringify(logRows.rows[0].output_summary);
    expect(summaryString).not.toContain('CITACAO_VERBATIM_SENTINELA');
    expect(summaryString).not.toContain('Empresa Fixture');
  });

  // Chamada real à API da Claude -- exceção já documentada do projeto.
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const maybeIt = hasApiKey ? it : it.skip;
  if (!hasApiKey) {
    console.warn('ANTHROPIC_API_KEY ausente -- pulando teste de integração real com a Claude API (ResumeStructuringService)');
  }

  maybeIt('estrutura um currículo real, cada citacaoVerbatim é localizável, e a chamada fica registrada em llm_call_log SEM o payload bruto', async () => {
    const router = new ModelRouterService(new AuditLogService(), new AnthropicAdapter(), new OpenAiAdapter());
    const service = new ResumeStructuringService(router);

    const resultado = await tenantContext.run(tenantId, (client) => service.structure(client, tenantId, TEXTO_CURRICULO));

    expect(resultado.experiencias.length).toBeGreaterThan(0);
    expect(resultado.formacao.length).toBeGreaterThan(0);

    const todosItens = [...resultado.experiencias, ...resultado.formacao, ...resultado.habilidades];
    for (const item of todosItens) {
      const offset = locateVerbatimOffset(TEXTO_CURRICULO, item.citacaoVerbatim);
      expect(offset).not.toBeNull();
    }

    const logRows = await tenantContext.run(tenantId, (client) =>
      client.query<{ output_summary: unknown }>(
        `SELECT prompt_id, output_summary FROM llm_call_log WHERE tenant_id = $1 AND prompt_id = 'resume-parsing'`,
        [tenantId],
      ),
    );
    expect(logRows.rows).toHaveLength(1);

    // [Fix 6 da revisão final] output_summary é o resumo estrutural (só
    // contagens), nunca o payload bruto com citações verbatim do CV --
    // dado pessoal do candidato não deve ficar duplicado nesta tabela de
    // telemetria.
    const summaryString = JSON.stringify(logRows.rows[0].output_summary);
    for (const item of todosItens) {
      expect(summaryString).not.toContain(item.citacaoVerbatim);
    }
  }, 30000);
});

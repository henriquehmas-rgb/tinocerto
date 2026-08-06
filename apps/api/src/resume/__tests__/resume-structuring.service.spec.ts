import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AuditLogService } from '../../trust/audit-log.service';
import { AnthropicAdapter, OpenAiAdapter } from '../../llm-router/provider-adapter';
import { ModelRouterService } from '../../llm-router/model-router.service';
import { ResumeStructuringService } from '../resume-structuring.service';
import { locateVerbatimOffset } from '../locate-verbatim-offset';

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

  // Chamada real à API da Claude -- exceção já documentada do projeto.
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const maybeIt = hasApiKey ? it : it.skip;
  if (!hasApiKey) {
    console.warn('ANTHROPIC_API_KEY ausente -- pulando teste de integração real com a Claude API (ResumeStructuringService)');
  }

  maybeIt('estrutura um currículo real, cada citacaoVerbatim é localizável, e a chamada fica registrada em llm_call_log', async () => {
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
      client.query(`SELECT prompt_id FROM llm_call_log WHERE tenant_id = $1 AND prompt_id = 'resume-parsing'`, [tenantId]),
    );
    expect(logRows.rows).toHaveLength(1);
  }, 30000);
});

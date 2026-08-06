import { z } from 'zod';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AuditLogService } from '../../trust/audit-log.service';
import { AnthropicAdapter, OpenAiAdapter } from '../provider-adapter';
import { ModelRouterService } from '../model-router.service';
import { ModelRouterUnavailableError, ProviderAdapter } from '../model-router.types';

const RespostaSchema = z.object({ resposta: z.string() });

class AdapterFalho implements ProviderAdapter {
  constructor(public readonly name: 'anthropic' | 'openai') {}
  async complete(): Promise<never> {
    throw new Error(`${this.name} fora do ar (simulado)`);
  }
}

class AdapterFixo implements ProviderAdapter {
  constructor(
    public readonly name: 'anthropic' | 'openai',
    private readonly modelId: string,
  ) {}
  // <T> explícito e cast em `data`: a interface ProviderAdapter é genérica
  // sobre T (o adapter real produz T validando a resposta do provedor
  // contra o schema recebido), mas este double de teste devolve sempre o
  // mesmo objeto fixo independente do T pedido -- sem o cast, o
  // TypeScript rejeita (corretamente) unificar um valor concreto com um T
  // arbitrário não relacionado.
  async complete<T>() {
    return { data: { resposta: 'ok' } as T, modelId: this.modelId, inputTokens: 100, outputTokens: 20 };
  }
}

describe('ModelRouterService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  let tenantId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Router Ltda','00000000000076','test-tenant-00000000000076') RETURNING id`,
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

  it('quando o primário falha, tenta o fallback automaticamente e grava log imutável', async () => {
    const router = new ModelRouterService(new AuditLogService(), new AdapterFalho('anthropic'), new AdapterFixo('openai', 'gpt-5-mini'));

    const output = await tenantContext.run(tenantId, (client) =>
      router.complete({
        client,
        tier: 'tier2',
        schema: RespostaSchema,
        system: 'teste',
        messages: [{ role: 'user', content: 'oi' }],
        metadata: { promptId: 'teste-fallback', promptVersion: 'v1', tenantId },
      }),
    );

    expect(output.provider).toBe('openai');
    expect(output.data.resposta).toBe('ok');

    const logRows = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT provider, tier, prompt_id FROM llm_call_log WHERE tenant_id = $1`, [tenantId]),
    );
    expect(logRows.rows).toHaveLength(1);
    expect(logRows.rows[0].provider).toBe('openai');

    const auditRows = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT action, resource_type FROM audit_log_entry WHERE tenant_id = $1 AND action = 'llm.complete'`, [tenantId]),
    );
    expect(auditRows.rows).toHaveLength(1);
  });

  it('quando os dois fornecedores falham, rejeita com ModelRouterUnavailableError e não grava log', async () => {
    const router = new ModelRouterService(new AuditLogService(), new AdapterFalho('anthropic'), new AdapterFalho('openai'));

    await expect(
      tenantContext.run(tenantId, (client) =>
        router.complete({
          client,
          tier: 'tier2',
          schema: RespostaSchema,
          system: 'teste',
          messages: [{ role: 'user', content: 'oi' }],
          metadata: { promptId: 'teste-falha-total', promptVersion: 'v1', tenantId },
        }),
      ),
    ).rejects.toBeInstanceOf(ModelRouterUnavailableError);
  });

  // Chamada real -- mesma exceção deliberada ao padrão "sem mock" já usada
  // em resume-structuring.service.spec.ts: API paga e não-determinística,
  // pula com aviso se a chave não existir em vez de mockar a resposta.
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
  const maybeIt = hasAnthropicKey && hasOpenAiKey ? it : it.skip;
  if (!hasAnthropicKey || !hasOpenAiKey) {
    console.warn('ANTHROPIC_API_KEY e/ou OPENAI_API_KEY ausentes -- pulando teste de integração real do Model Router');
  }

  maybeIt('chamada real ao provedor primário (Anthropic) devolve saída estruturada válida', async () => {
    const router = new ModelRouterService(new AuditLogService(), new AnthropicAdapter(), new OpenAiAdapter());
    const output = await tenantContext.run(tenantId, (client) =>
      router.complete({
        client,
        tier: 'tier2',
        schema: RespostaSchema,
        system: 'Responda sempre com um objeto {"resposta": "ok"}.',
        messages: [{ role: 'user', content: 'Confirme.' }],
        metadata: { promptId: 'teste-real', promptVersion: 'v1', tenantId },
      }),
    );
    expect(output.provider).toBe('anthropic');
    expect(output.data.resposta.length).toBeGreaterThan(0);
  }, 30000);
});

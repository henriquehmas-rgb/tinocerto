// apps/api/src/llm-router/model-router.service.ts
import { createHash, randomUUID } from 'crypto';
import { AuditLogService } from '../trust/audit-log.service';
import {
  ModelRouterInput,
  ModelRouterOutput,
  ModelRouterUnavailableError,
  PRICING_USD_PER_1M_TOKENS,
  ProviderAdapter,
} from './model-router.types';

export class ModelRouterService {
  constructor(
    private readonly auditLog: AuditLogService,
    private readonly primary: ProviderAdapter,
    private readonly fallback: ProviderAdapter,
  ) {}

  async complete<T>(input: ModelRouterInput<T>): Promise<ModelRouterOutput<T>> {
    const start = Date.now();
    let result: { data: T; modelId: string; inputTokens: number; outputTokens: number };
    let providerName: 'anthropic' | 'openai';

    try {
      result = await this.primary.complete(input.tier, input.schema, input.system, input.messages);
      providerName = this.primary.name;
    } catch (primaryErr) {
      try {
        result = await this.fallback.complete(input.tier, input.schema, input.system, input.messages);
        providerName = this.fallback.name;
      } catch (fallbackErr) {
        throw new ModelRouterUnavailableError(input.tier, primaryErr, fallbackErr);
      }
    }

    const latencyMs = Date.now() - start;
    const pricing = PRICING_USD_PER_1M_TOKENS[result.modelId] ?? { input: 0, output: 0 };
    const costUsd =
      (result.inputTokens / 1_000_000) * pricing.input + (result.outputTokens / 1_000_000) * pricing.output;
    const inputHash = createHash('sha256')
      .update(JSON.stringify({ system: input.system, messages: input.messages }))
      .digest('hex');

    const llmCallId = randomUUID();
    await input.client.query(
      `INSERT INTO llm_call_log
         (id, tenant_id, actor_id, actor_type, tier, provider, model_id, prompt_id, prompt_version,
          input_hash, output_summary, custo_usd, latencia_ms, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
      [
        llmCallId,
        input.metadata.tenantId,
        input.metadata.actorId ?? null,
        input.metadata.actorId ? 'user' : 'system',
        input.tier,
        providerName,
        result.modelId,
        input.metadata.promptId,
        input.metadata.promptVersion,
        inputHash,
        JSON.stringify(result.data),
        costUsd,
        latencyMs,
      ],
    );

    await this.auditLog.append(input.client, {
      tenantId: input.metadata.tenantId,
      actorId: input.metadata.actorId,
      actorType: input.metadata.actorId ? 'user' : 'system',
      action: 'llm.complete',
      resourceType: 'llm_call_log',
      resourceId: llmCallId,
      occurredAt: new Date(),
    });

    return { data: result.data, modelId: result.modelId, provider: providerName, latencyMs, costUsd };
  }
}

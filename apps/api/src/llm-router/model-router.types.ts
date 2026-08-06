// apps/api/src/llm-router/model-router.types.ts
import { PoolClient } from 'pg';
import { ZodType } from 'zod';

export type ModelTier = 'tier2' | 'tier3';

export interface ModelRouterInput<T> {
  client: PoolClient;
  tier: ModelTier;
  schema: ZodType<T>;
  system: string;
  messages: { role: 'user'; content: string }[];
  metadata: {
    promptId: string;
    promptVersion: string;
    tenantId: string;
    actorId?: string;
  };
}

export interface ModelRouterOutput<T> {
  data: T;
  modelId: string;
  provider: 'anthropic' | 'openai';
  latencyMs: number;
  costUsd: number;
}

export interface ProviderCompletionResult<T> {
  data: T;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderAdapter {
  readonly name: 'anthropic' | 'openai';
  complete<T>(
    tier: ModelTier,
    schema: ZodType<T>,
    system: string,
    messages: { role: 'user'; content: string }[],
  ): Promise<ProviderCompletionResult<T>>;
}

export class ModelRouterUnavailableError extends Error {
  constructor(
    public readonly tier: ModelTier,
    public readonly primaryError: unknown,
    public readonly fallbackError: unknown,
  ) {
    super(
      `Nenhum fornecedor disponível para o tier ${tier}: primário falhou (${String(primaryError)}), fallback falhou (${String(fallbackError)})`,
    );
    this.name = 'ModelRouterUnavailableError';
  }
}

// Nomes de modelo por tier -- tier2 é a classe barata (parsing, resumos,
// geração de conteúdo), tier3 é a classe grande (reservada para avaliação
// com rubrica, sem consumidor real ainda nesta fase). tier1 (self-hosted)
// permanece fora do roadmap até o volume justificar (doc 05 §5.1/§5.5).
export const TIER_CONFIG: Record<ModelTier, { anthropic: string; openai: string }> = {
  tier2: { anthropic: 'claude-haiku-5', openai: 'gpt-5-mini' },
  tier3: { anthropic: 'claude-opus-5', openai: 'gpt-5' },
};

// USD por 1M tokens -- estimativa a reconciliar com a página de preço real
// de cada fornecedor quando o billing for configurado; não bloqueia a
// corretude do router (custo_usd é telemetria, não controle de acesso).
export const PRICING_USD_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-haiku-5': { input: 0.8, output: 4 },
  'claude-opus-5': { input: 15, output: 75 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5': { input: 5, output: 15 },
};

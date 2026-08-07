// apps/api/src/llm-router/provider-adapter.ts
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ZodType } from 'zod';
import { ModelTier, ProviderAdapter, ProviderCompletionResult, TIER_CONFIG } from './model-router.types';

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = 'anthropic' as const;
  private client: Anthropic | undefined;

  private getClient(): Anthropic {
    if (!this.client) {
      // [Fix 2 da revisão final] Timeout explícito -- o default do SDK
      // (~10 min) deixaria um socket travado do fornecedor prender uma
      // conexão do pool de Postgres (e o advisory lock de audit-log do
      // tenant) pelo tempo que o SDK decidir, não por um limite que
      // alguém escolheu.
      this.client = new Anthropic({ timeout: 60_000 });
    }
    return this.client;
  }

  async complete<T>(
    tier: ModelTier,
    schema: ZodType<T>,
    system: string,
    messages: { role: 'user'; content: string }[],
  ): Promise<ProviderCompletionResult<T>> {
    const model = TIER_CONFIG[tier].anthropic;
    const response = await this.getClient().messages.parse({
      model,
      max_tokens: 4096,
      system,
      output_config: { format: zodOutputFormat(schema) },
      messages,
    });
    if (!response.parsed_output) {
      throw new Error(`Anthropic (${model}) não retornou saída estruturada válida`);
    }
    return {
      data: response.parsed_output,
      modelId: model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

export class OpenAiAdapter implements ProviderAdapter {
  readonly name = 'openai' as const;
  private client: OpenAI | undefined;

  private getClient(): OpenAI {
    if (!this.client) {
      // [Fix 2 da revisão final] Mesmo motivo do timeout em AnthropicAdapter
      // acima -- socket travado não deve poder prender uma conexão do pool
      // indefinidamente.
      this.client = new OpenAI({ timeout: 60_000 });
    }
    return this.client;
  }

  async complete<T>(
    tier: ModelTier,
    schema: ZodType<T>,
    system: string,
    messages: { role: 'user'; content: string }[],
  ): Promise<ProviderCompletionResult<T>> {
    const model = TIER_CONFIG[tier].openai;
    const response = await this.getClient().chat.completions.parse({
      model,
      // Simétrico ao max_tokens: 4096 do AnthropicAdapter acima --
      // max_completion_tokens é o parâmetro atual do SDK da OpenAI
      // (max_tokens está deprecated a favor dele, ver openai/resources/
      // chat/completions/completions.d.ts na versão instalada).
      max_completion_tokens: 4096,
      messages: [{ role: 'system', content: system }, ...messages],
      response_format: zodResponseFormat(schema, 'resultado'),
    });
    const parsed = response.choices[0]?.message.parsed;
    if (!parsed) {
      throw new Error(`OpenAI (${model}) não retornou saída estruturada válida`);
    }
    return {
      data: parsed,
      modelId: model,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }
}

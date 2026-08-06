// apps/api/src/llm-router/provider-adapter.ts
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ZodType } from 'zod';
import { ModelTier, ProviderAdapter, ProviderCompletionResult, TIER_CONFIG } from './model-router.types';

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = 'anthropic' as const;
  private readonly client = new Anthropic();

  async complete<T>(
    tier: ModelTier,
    schema: ZodType<T>,
    system: string,
    messages: { role: 'user'; content: string }[],
  ): Promise<ProviderCompletionResult<T>> {
    const model = TIER_CONFIG[tier].anthropic;
    const response = await this.client.messages.parse({
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
  private readonly client = new OpenAI();

  async complete<T>(
    tier: ModelTier,
    schema: ZodType<T>,
    system: string,
    messages: { role: 'user'; content: string }[],
  ): Promise<ProviderCompletionResult<T>> {
    const model = TIER_CONFIG[tier].openai;
    const response = await this.client.chat.completions.parse({
      model,
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

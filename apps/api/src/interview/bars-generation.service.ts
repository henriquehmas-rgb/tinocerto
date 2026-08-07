import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { ModelRouterService } from '../llm-router/model-router.service';
import { InterviewGuideService } from './interview-guide.service';

const AncoraSchema = z.object({
  nivel: z.number().int().min(1).max(5),
  descricaoComportamental: z.string().min(1),
});

const CompetenciaSugeridaSchema = z.object({
  nome: z.string().min(1),
  ancoras: z
    .array(AncoraSchema)
    .length(5)
    .refine(
      (ancoras) => new Set(ancoras.map((a) => a.nivel)).size === 5,
      { message: 'As 5 âncoras devem cobrir os níveis 1 a 5 exatamente uma vez cada' },
    ),
});

const GeracaoRoteiroSchema = z.object({
  competencias: z.array(CompetenciaSugeridaSchema).min(1),
});

const SYSTEM_PROMPT =
  'Você ajuda recrutadores brasileiros a montar roteiros de entrevista estruturada com âncoras comportamentais (BARS). A partir da descrição de uma vaga, sugira de 3 a 6 competências relevantes para avaliar, cada uma com exatamente 5 âncoras comportamentais (níveis 1 a 5, do desempenho mais fraco ao mais forte). Cada âncora deve descrever um COMPORTAMENTO OBSERVÁVEL em entrevista, nunca um traço de personalidade vago. Nunca sugira competências ou linguagem que discrimine por idade, gênero, raça, religião, deficiência, estado civil ou nacionalidade.';

export interface GerarRascunhoInput {
  tenantId: string;
  jobId: string;
  tituloVaga: string;
  textoRequisicao: string;
  criadoPor?: string;
  actorId?: string;
}

@Injectable()
export class BarsGenerationService {
  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly guideService: InterviewGuideService,
  ) {}

  async gerarRascunho(client: PoolClient, input: GerarRascunhoInput): Promise<{ id: string }> {
    const output = await this.modelRouter.complete({
      client,
      tier: 'tier2',
      schema: GeracaoRoteiroSchema,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Vaga: ${input.tituloVaga}\n\nRequisição:\n${input.textoRequisicao}` }],
      metadata: {
        promptId: 'bars-generation',
        promptVersion: 'v1',
        tenantId: input.tenantId,
        actorId: input.actorId,
      },
    });

    // O ModelRouterService não valida `output.data` contra o schema em tempo
    // de execução -- isso só acontece de fato dentro dos adapters reais, via
    // zodOutputFormat/zodResponseFormat do SDK de cada fornecedor. Para
    // qualquer adapter que não passe pelo SDK (o fixture determinístico dos
    // testes, ou um fornecedor futuro que devolva algo fora do formato),
    // validamos aqui de novo antes de persistir -- é o que garante que as 5
    // âncoras por competência são regra de verdade, não só o tipo TypeScript.
    const validado = GeracaoRoteiroSchema.parse(output.data);

    return this.guideService.criarRascunho(client, {
      tenantId: input.tenantId,
      jobId: input.jobId,
      criadoPor: input.criadoPor,
      competencias: validado.competencias,
    });
  }
}

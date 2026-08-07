import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { ModelRouterService } from '../llm-router/model-router.service';
import { InterviewGuideService } from './interview-guide.service';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';

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
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly guideService: InterviewGuideService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  async gerarRascunho(client: PoolClient, input: GerarRascunhoInput): Promise<{ id: string }> {
    // [Fix 2 da revisão final] Transação PRÓPRIA, separada da transação do
    // chamador (que só cobre criarRascunho) -- garante que o log da
    // chamada de IA sobrevive mesmo que criarRascunho falhe depois (ex.:
    // job_id inválido). Mesmo princípio já usado em
    // resume-parsing.consumer.ts: sem isso, uma chamada de IA real e
    // faturada some do llm_call_log se a escrita seguinte, na MESMA
    // transação, for revertida por qualquer motivo alheio à chamada em si.
    const output = await this.tenantContext.run(input.tenantId, (llmClient) =>
      this.modelRouter.complete({
        client: llmClient,
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
      }),
    );

    // [Fix 1 da revisão final] O ModelRouterService agora valida `data`
    // contra o schema recebido em TODO caminho (primário ou fallback) antes
    // de devolver -- ver model-router.service.ts. O `.parse()` explícito
    // que existia aqui era um workaround para a mesma lacuna, redundante
    // agora que o router garante a invariante para qualquer consumidor.
    return this.guideService.criarRascunho(client, {
      tenantId: input.tenantId,
      jobId: input.jobId,
      criadoPor: input.criadoPor,
      competencias: output.data.competencias,
    });
  }
}

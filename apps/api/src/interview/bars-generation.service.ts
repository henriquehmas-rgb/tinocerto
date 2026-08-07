import { Injectable } from '@nestjs/common';
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

  // [Fix da revisão de segunda passagem pós-66fc25a] As DUAS transações
  // abaixo são estritamente SEQUENCIAIS, nunca aninhadas: a primeira
  // (chamada de IA) faz BEGIN...COMMIT e libera seu client de volta à pool
  // -- tudo isso já aconteceu quando o `await` abaixo retorna -- antes da
  // segunda (criarRascunho) sequer chamar `pool.connect()`. Nenhum client
  // de uma permanece "em escopo" enquanto a outra está aberta. Isso evita
  // o deadlock da pool inteira sob carga concorrente: antes, o controller
  // segurava um client durante toda a requisição e este método abria um
  // SEGUNDO client (mesma pool) aninhado dentro do primeiro, preso até 60s
  // (timeout do LLM) -- com poucas conexões concorrentes, a pool inteira
  // (default do pg: max 10) travava esperando por clients que nunca seriam
  // liberados. Mesmo princípio de log sobrevivendo a rollback do Fix 2 da
  // revisão final (66fc25a) é preservado: as duas transações continuam
  // separadas, então uma falha em criarRascunho não reverte o log da
  // chamada de IA já commitada.
  async gerarRascunho(input: GerarRascunhoInput): Promise<{ id: string }> {
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
    return this.tenantContext.run(input.tenantId, (client) =>
      this.guideService.criarRascunho(client, {
        tenantId: input.tenantId,
        jobId: input.jobId,
        criadoPor: input.criadoPor,
        competencias: output.data.competencias,
      }),
    );
  }
}

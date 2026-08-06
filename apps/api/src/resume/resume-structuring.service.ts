import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { ModelRouterService } from '../llm-router/model-router.service';

const ResumeSchema = z.object({
  experiencias: z.array(
    z.object({
      cargo: z.string(),
      empresa: z.string(),
      periodo: z.string(),
      descricao: z.string(),
      citacaoVerbatim: z
        .string()
        .describe('Trecho copiado EXATAMENTE do texto original que comprova este item -- nunca parafraseado'),
    }),
  ),
  formacao: z.array(
    z.object({
      curso: z.string(),
      instituicao: z.string(),
      periodo: z.string(),
      citacaoVerbatim: z.string().describe('Trecho copiado EXATAMENTE do texto original'),
    }),
  ),
  habilidades: z.array(
    z.object({
      nome: z.string(),
      citacaoVerbatim: z.string().describe('Trecho copiado EXATAMENTE do texto original'),
    }),
  ),
});

export type StructuredResume = z.infer<typeof ResumeSchema>;

const SYSTEM_PROMPT =
  'Extraia experiências profissionais, formação e habilidades do currículo abaixo. Para cada item, o campo "citacaoVerbatim" deve ser uma cópia EXATA (mesmos espaços, mesma pontuação) de um trecho do texto original que comprove aquele item -- nunca parafraseado, nunca inventado. Se não houver um trecho exato que comprove um item, não inclua o item.';

@Injectable()
export class ResumeStructuringService {
  constructor(private readonly modelRouter: ModelRouterService) {}

  async structure(client: PoolClient, tenantId: string, texto: string): Promise<StructuredResume> {
    const output = await this.modelRouter.complete({
      client,
      tier: 'tier2',
      schema: ResumeSchema,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: texto }],
      metadata: { promptId: 'resume-parsing', promptVersion: 'v1', tenantId },
    });
    return output.data;
  }
}

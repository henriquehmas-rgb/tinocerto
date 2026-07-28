import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

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

@Injectable()
export class ResumeStructuringService {
  private readonly client = new Anthropic();

  async structure(texto: string): Promise<StructuredResume> {
    const response = await this.client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 4096,
      output_config: { format: zodOutputFormat(ResumeSchema) },
      messages: [
        {
          role: 'user',
          content: `Extraia experiências profissionais, formação e habilidades do currículo abaixo. Para cada item, o campo "citacaoVerbatim" deve ser uma cópia EXATA (mesmos espaços, mesma pontuação) de um trecho do texto original que comprove aquele item -- nunca parafraseado, nunca inventado. Se não houver um trecho exato que comprove um item, não inclua o item.\n\n${texto}`,
        },
      ],
    });

    if (!response.parsed_output) {
      throw new Error('Claude não retornou uma estrutura válida para o currículo');
    }
    return response.parsed_output;
  }
}

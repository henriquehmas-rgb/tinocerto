// apps/api/src/copilot/interview-question-suggestion.service.ts
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { ModelRouterService } from '../llm-router/model-router.service';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';

interface AncoraSnapshot {
  nivel: number;
  descricaoComportamental: string;
}
interface CompetenciaSnapshot {
  competencyId: string;
  nome: string;
  ancoras: AncoraSnapshot[];
}

const SYSTEM_PROMPT =
  'Você ajuda recrutadores brasileiros a preparar perguntas de entrevista estruturada. Para CADA competência abaixo (com suas âncoras comportamentais de nível 1 a 5), sugira de 1 a 4 perguntas que ajudem o entrevistador a identificar em qual nível o candidato se encontra -- baseie as perguntas nos comportamentos descritos nas âncoras, no formato STAR (peça exemplo concreto de comportamento passado, nunca pergunta hipotética genérica). Nunca invente competência fora da lista fornecida, nunca combine duas competências numa pergunta só, nunca inclua pergunta que revele ou presuma idade, gênero, raça, religião, deficiência, estado civil, nacionalidade ou situação de saúde.';

function montarPromptCompetencias(snapshot: CompetenciaSnapshot[]): string {
  return snapshot
    .map((c) => `[${c.competencyId}] ${c.nome}\n${c.ancoras.map((a) => `  Nível ${a.nivel}: ${a.descricaoComportamental}`).join('\n')}`)
    .join('\n\n');
}

export class InterviewGuideVersionNotFoundError extends Error {}

export interface ItemPerguntaSugerida {
  competencyId: string;
  nome: string;
  perguntas: string[];
}

export interface InterviewQuestionSuggestion {
  id: string;
  interviewGuideVersionId: string;
  itens: ItemPerguntaSugerida[];
  criadoEm: Date;
}

@Injectable()
export class InterviewQuestionSuggestionService {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly modelRouter: ModelRouterService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  async gerar(input: { tenantId: string; interviewGuideVersionId: string; actorId?: string }): Promise<InterviewQuestionSuggestion> {
    return this.tenantContext.run(input.tenantId, async (client) => {
      const version = await client.query<{ competencias_snapshot: CompetenciaSnapshot[] }>(
        `SELECT competencias_snapshot FROM interview_guide_version WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.interviewGuideVersionId],
      );
      if (version.rows.length === 0) {
        throw new InterviewGuideVersionNotFoundError(`interview_guide_version ${input.interviewGuideVersionId} não encontrada para o tenant`);
      }
      const snapshot = version.rows[0].competencias_snapshot;
      const competencyIds = snapshot.map((c) => c.competencyId) as [string, ...string[]];

      // Enum dinâmico + refine de cobertura 1:1 -- mesma técnica já usada
      // em bars-generation.service.ts (Fase 3a) para as 5 âncoras. Como
      // ModelRouterService.complete já roda schema.parse(data) em toda
      // tentativa (primária e fallback), uma saída que invente uma
      // competência ou deixe uma de fora já É tratada como falha de
      // fornecedor -- nenhuma verificação de domínio adicional é
      // necessária aqui (decisão 10 do design spec desta fase).
      const PerguntaPorCompetenciaSchema = z.object({
        competencyId: z.enum(competencyIds),
        perguntas: z.array(z.string().min(1)).min(1).max(4),
      });
      const SugestaoPerguntasSchema = z
        .object({ itens: z.array(PerguntaPorCompetenciaSchema) })
        .refine(
          (data) => {
            const ids = new Set(data.itens.map((i) => i.competencyId));
            return ids.size === competencyIds.length && competencyIds.every((id) => ids.has(id));
          },
          { message: 'Deve haver exatamente um item por competência do guia, sem repetição nem invenção de competência fora do snapshot' },
        );

      const output = await this.modelRouter.complete({
        client,
        tier: 'tier2',
        schema: SugestaoPerguntasSchema,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: montarPromptCompetencias(snapshot) }],
        metadata: { promptId: 'interview-question-suggestion', promptVersion: 'v1', tenantId: input.tenantId, actorId: input.actorId },
      });

      const nomesPorId = new Map(snapshot.map((c) => [c.competencyId, c.nome]));
      const itens: ItemPerguntaSugerida[] = output.data.itens.map((i) => ({
        competencyId: i.competencyId,
        nome: nomesPorId.get(i.competencyId)!,
        perguntas: i.perguntas,
      }));

      const inserted = await client.query<{ id: string; criado_em: Date }>(
        `INSERT INTO interview_question_suggestion (tenant_id, interview_guide_version_id, itens, criado_por)
         VALUES ($1, $2, $3, $4) RETURNING id, criado_em`,
        [input.tenantId, input.interviewGuideVersionId, JSON.stringify(itens), input.actorId ?? null],
      );

      return { id: inserted.rows[0].id, interviewGuideVersionId: input.interviewGuideVersionId, itens, criadoEm: inserted.rows[0].criado_em };
    });
  }

  async listar(client: PoolClient, tenantId: string, interviewGuideVersionId: string): Promise<InterviewQuestionSuggestion[]> {
    const result = await client.query<{ id: string; itens: ItemPerguntaSugerida[]; criado_em: Date }>(
      `SELECT id, itens, criado_em FROM interview_question_suggestion
       WHERE tenant_id = $1 AND interview_guide_version_id = $2 ORDER BY criado_em DESC`,
      [tenantId, interviewGuideVersionId],
    );
    return result.rows.map((row) => ({ id: row.id, interviewGuideVersionId, itens: row.itens, criadoEm: row.criado_em }));
  }
}

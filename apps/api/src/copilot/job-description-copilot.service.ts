// apps/api/src/copilot/job-description-copilot.service.ts
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { ModelRouterService } from '../llm-router/model-router.service';
import { AuditLogService } from '../trust/audit-log.service';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';

const DescricaoReescritaSchema = z.object({
  textoReescrito: z.string().min(1).max(20000),
});

const SYSTEM_PROMPT =
  'Você reescreve descrições de vaga em português do Brasil para usar linguagem inclusiva -- evite termos que desencorajem candidaturas por gênero, idade, deficiência, raça ou qualquer característica protegida. Preserve INTEGRALMENTE o significado original e todos os requisitos técnicos e factuais (senioridade, requisitos, benefícios, faixa salarial se presente) -- ajuste só a linguagem, nunca invente nem remova informação. Devolva o texto completo reescrito, nunca um resumo ou um trecho.';

export class JobNotFoundError extends Error {}
export class JobDescriptionSuggestionNotFoundError extends Error {}
export class JobDescriptionSuggestionStaleError extends Error {}

export interface JobDescriptionSuggestion {
  id: string;
  jobId: string;
  textoOriginal: string;
  textoSugerido: string;
  criadoEm: Date;
}

@Injectable()
export class JobDescriptionCopilotService {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly auditLog: AuditLogService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // Diferente de CandidateSummaryService.gerar (Task 3), esta operação não
  // tem um passo de verificação que possa rejeitar a saída do LLM depois
  // de já ter comitado -- qualquer reescrita em linguagem inclusiva é
  // aceita. Por isso ler a vaga, chamar o router e gravar a sugestão cabem
  // numa única transação.
  async sugerir(input: { tenantId: string; jobId: string; actorId?: string }): Promise<JobDescriptionSuggestion> {
    return this.tenantContext.run(input.tenantId, async (client) => {
      const job = await client.query<{ titulo: string; descricao: string }>(
        `SELECT titulo, descricao FROM job WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.jobId],
      );
      if (job.rows.length === 0) {
        throw new JobNotFoundError(`Vaga ${input.jobId} não encontrada para o tenant`);
      }
      const textoOriginal = job.rows[0].descricao;

      const output = await this.modelRouter.complete({
        client,
        tier: 'tier2',
        schema: DescricaoReescritaSchema,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Título da vaga: ${job.rows[0].titulo}\n\nDescrição atual:\n${textoOriginal}` }],
        metadata: { promptId: 'job-description-rewrite', promptVersion: 'v1', tenantId: input.tenantId, actorId: input.actorId },
      });

      const inserted = await client.query<{ id: string; criado_em: Date }>(
        `INSERT INTO job_description_suggestion (tenant_id, job_id, texto_original, texto_sugerido, criado_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, criado_em`,
        [input.tenantId, input.jobId, textoOriginal, output.data.textoReescrito, input.actorId ?? null],
      );

      return {
        id: inserted.rows[0].id,
        jobId: input.jobId,
        textoOriginal,
        textoSugerido: output.data.textoReescrito,
        criadoEm: inserted.rows[0].criado_em,
      };
    });
  }

  async aplicar(input: { tenantId: string; jobId: string; suggestionId: string; actorId?: string }): Promise<{
    jobId: string;
    descricao: string;
    suggestionId: string;
    aplicadoEm: Date;
  }> {
    return this.tenantContext.run(input.tenantId, async (client) => {
      const suggestion = await client.query<{ texto_original: string; texto_sugerido: string }>(
        `SELECT texto_original, texto_sugerido FROM job_description_suggestion
         WHERE tenant_id = $1 AND id = $2 AND job_id = $3`,
        [input.tenantId, input.suggestionId, input.jobId],
      );
      if (suggestion.rows.length === 0) {
        throw new JobDescriptionSuggestionNotFoundError(`Sugestão ${input.suggestionId} não encontrada para esta vaga`);
      }
      const { texto_original: textoOriginal, texto_sugerido: textoSugerido } = suggestion.rows[0];

      // Guarda de concorrência otimista: só aplica se job.descricao ainda
      // for exatamente o texto que gerou esta sugestão -- se o recrutador
      // editou manualmente a descrição nesse meio-tempo, a condição não
      // bate e rowCount fica 0, em vez de sobrescrever a edição manual em
      // silêncio (decisão 2 do design spec, estendida a este caso).
      const updated = await client.query(
        `UPDATE job SET descricao = $1 WHERE tenant_id = $2 AND id = $3 AND descricao = $4`,
        [textoSugerido, input.tenantId, input.jobId, textoOriginal],
      );
      if (updated.rowCount === 0) {
        throw new JobDescriptionSuggestionStaleError(
          `A descrição da vaga ${input.jobId} mudou desde que esta sugestão foi gerada -- gere uma nova sugestão antes de aplicar`,
        );
      }

      const aplicadoEm = new Date();
      await client.query(
        `UPDATE job_description_suggestion SET aplicado_por = $1, aplicado_em = $2 WHERE tenant_id = $3 AND id = $4`,
        [input.actorId ?? null, aplicadoEm, input.tenantId, input.suggestionId],
      );

      await this.auditLog.append(client, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        actorType: input.actorId ? 'user' : 'system',
        action: 'copilot.job_description.apply',
        resourceType: 'job',
        resourceId: input.jobId,
        occurredAt: aplicadoEm,
      });

      return { jobId: input.jobId, descricao: textoSugerido, suggestionId: input.suggestionId, aplicadoEm };
    });
  }

  async listar(client: PoolClient, tenantId: string, jobId: string): Promise<JobDescriptionSuggestion[]> {
    const result = await client.query<{ id: string; texto_original: string; texto_sugerido: string; criado_em: Date }>(
      `SELECT id, texto_original, texto_sugerido, criado_em FROM job_description_suggestion
       WHERE tenant_id = $1 AND job_id = $2 ORDER BY criado_em DESC`,
      [tenantId, jobId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      jobId,
      textoOriginal: row.texto_original,
      textoSugerido: row.texto_sugerido,
      criadoEm: row.criado_em,
    }));
  }
}

// apps/api/src/copilot/candidate-summary.service.ts
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { ModelRouterService } from '../llm-router/model-router.service';
import { AuditLogService } from '../trust/audit-log.service';
import { TenantContext } from '../database/tenant-context';
import { DatabaseService } from '../database/database.service';
import { CitableSnippet, construirTrechosCitaveis } from './build-citable-snippets';
import { verificarCitacoesResumoCandidato } from './verify-candidate-summary-citations';

const SYSTEM_PROMPT =
  'Você escreve um resumo objetivo de candidato para recrutadores brasileiros, com base EXCLUSIVAMENTE nos trechos numerados fornecidos abaixo (já extraídos e verificados do currículo do candidato). Cada frase do resumo precisa corresponder a exatamente um trecho: informe o fonteId daquele trecho e copie, em citacaoVerbatim, uma cópia EXATA (mesma pontuação, mesmos espaços) de um pedaço contínuo do texto DAQUELE fonteId que sustente a frase -- nunca parafraseado, nunca combinando palavras de trechos diferentes. Nunca invente experiência, formação, habilidade, tempo de emprego ou qualquer fato que não esteja literalmente em um dos trechos. Nunca infira ou mencione idade, gênero, raça, religião, deficiência, estado civil ou nacionalidade. Escreva entre 2 e 6 frases.';

function montarPromptTrechos(trechos: CitableSnippet[]): string {
  return trechos.map((t) => `[${t.fonteId}] "${t.texto}"`).join('\n');
}

export class ApplicationNotFoundError extends Error {}
export class CandidateSummaryInsufficientDataError extends Error {}
export class CandidateSummaryDraftNotFoundError extends Error {}

export interface FraseResumo {
  texto: string;
  fonteId: string;
  secao: string;
  itemIndex: number;
  citacaoVerbatim: string;
}

export interface CandidateSummaryDraft {
  id: string;
  applicationId: string;
  frases: FraseResumo[];
  criadoEm: Date;
}

interface PersonProfileRow {
  experiencias: { citacaoVerbatim: string; offsetInicio: number | null }[];
  formacao: { citacaoVerbatim: string; offsetInicio: number | null }[];
  habilidades: { citacaoVerbatim: string; offsetInicio: number | null }[];
}

@Injectable()
export class CandidateSummaryService {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly auditLog: AuditLogService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  async gerar(input: { tenantId: string; applicationId: string; actorId?: string }): Promise<CandidateSummaryDraft> {
    // Transação 1 -- SEMPRE comita, independente do que a verificação
    // (fora dela, abaixo) decidir sobre o resultado. Garante que
    // llm_call_log prova a tentativa mesmo quando o resultado é rejeitado
    // -- mesmo princípio já fixado em bars-generation.service.ts (Fase
    // 3a): duas operações sequenciais e NUNCA aninhadas, uma falha na
    // segunda nunca reverte o log da primeira.
    const { trechos, frasesGeradas } = await this.tenantContext.run(input.tenantId, async (client) => {
      // Resolve person_id via application (tenant-scoped) -- NUNCA aceita
      // personId do chamador. Mesmo limite documentado em
      // person.service.ts: "o tenant nunca consulta Person diretamente".
      const app = await client.query<{ person_id: string }>(
        `SELECT person_id FROM application WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.applicationId],
      );
      if (app.rows.length === 0) {
        throw new ApplicationNotFoundError(`Candidatura ${input.applicationId} não encontrada para o tenant`);
      }
      const personId = app.rows[0].person_id;

      const profile = await client.query<PersonProfileRow>(
        `SELECT experiencias, formacao, habilidades FROM person_profile WHERE person_id = $1`,
        [personId],
      );
      const trechos = construirTrechosCitaveis(
        profile.rows[0] ?? { experiencias: [], formacao: [], habilidades: [] },
      );
      if (trechos.length === 0) {
        throw new CandidateSummaryInsufficientDataError(
          `Candidato da candidatura ${input.applicationId} não tem nenhum item de currículo com citação verificada -- não é possível gerar um resumo grounded`,
        );
      }

      // Enum dinâmico -- só os fonteId reais deste candidato são valores
      // válidos de saída; a própria camada de schema estruturado do
      // fornecedor já impede o LLM de referenciar uma fonte inexistente
      // (defesa em profundidade, não a única linha -- verificarCitacoes...
      // roda de qualquer forma abaixo).
      const fonteIds = trechos.map((t) => t.fonteId) as [string, ...string[]];
      const FraseSchema = z.object({
        texto: z.string().min(1).max(400),
        fonteId: z.enum(fonteIds),
        citacaoVerbatim: z.string().min(1),
      });
      const ResumoCandidatoSchema = z.object({ frases: z.array(FraseSchema).min(1).max(6) });

      const output = await this.modelRouter.complete({
        client,
        tier: 'tier2',
        schema: ResumoCandidatoSchema,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: montarPromptTrechos(trechos) }],
        metadata: { promptId: 'candidate-summary', promptVersion: 'v1', tenantId: input.tenantId, actorId: input.actorId },
        // Minimização de dados: o texto do resumo é dado pessoal do
        // candidato -- llm_call_log é telemetria, não desenhado para o
        // alcance de um pedido de eliminação LGPD (mesmo raciocínio já
        // aplicado em resume-structuring.service.ts). Gravamos só a
        // contagem e quais fontes foram citadas.
        logOutputAs: (data) => ({ quantidadeFrases: data.frases.length, fontesUsadas: data.frases.map((f) => f.fonteId) }),
      });

      return { trechos, frasesGeradas: output.data.frases };
    });

    // Verificação FORA da transação acima -- pura, síncrona, sem I/O.
    // Deliberadamente depois do commit: uma rejeição aqui não desfaz o log
    // já gravado. Lança CitacaoNaoVerificavelError na primeira frase
    // inválida -- rejeita o resumo INTEIRO (decisão 7 do design spec).
    verificarCitacoesResumoCandidato(frasesGeradas, trechos);

    // Transação 2 -- só roda se a verificação acima não lançou.
    return this.tenantContext.run(input.tenantId, async (client) => {
      const frases: FraseResumo[] = frasesGeradas.map((f) => {
        const trecho = trechos.find((t) => t.fonteId === f.fonteId)!;
        return { texto: f.texto, fonteId: f.fonteId, secao: trecho.secao, itemIndex: trecho.itemIndex, citacaoVerbatim: f.citacaoVerbatim };
      });

      const inserted = await client.query<{ id: string; criado_em: Date }>(
        `INSERT INTO candidate_summary_draft (tenant_id, application_id, frases, criado_por)
         VALUES ($1, $2, $3, $4) RETURNING id, criado_em`,
        [input.tenantId, input.applicationId, JSON.stringify(frases), input.actorId ?? null],
      );

      return { id: inserted.rows[0].id, applicationId: input.applicationId, frases, criadoEm: inserted.rows[0].criado_em };
    });
  }

  async aplicar(input: { tenantId: string; applicationId: string; draftId: string; actorId?: string }): Promise<{
    id: string;
    aplicadoEm: Date;
  }> {
    return this.tenantContext.run(input.tenantId, async (client) => {
      const aplicadoEm = new Date();
      const result = await client.query<{ id: string }>(
        `UPDATE candidate_summary_draft SET aplicado_por = $1, aplicado_em = $2
         WHERE tenant_id = $3 AND id = $4 AND application_id = $5
         RETURNING id`,
        [input.actorId ?? null, aplicadoEm, input.tenantId, input.draftId, input.applicationId],
      );
      if (result.rows.length === 0) {
        throw new CandidateSummaryDraftNotFoundError(`Rascunho ${input.draftId} não encontrado para esta candidatura`);
      }

      await this.auditLog.append(client, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        actorType: input.actorId ? 'user' : 'system',
        action: 'copilot.candidate_summary.apply',
        resourceType: 'candidate_summary_draft',
        resourceId: input.draftId,
        occurredAt: aplicadoEm,
      });

      return { id: result.rows[0].id, aplicadoEm };
    });
  }

  // Devolve o rascunho vigente (mais recente entre os já aplicados), ou
  // null se nenhum foi aplicado ainda -- "aplicar" aqui só marca qual
  // rascunho é o vigente PARA ESTA candidatura (decisão 6 do design spec),
  // nunca escreve em nenhum campo global do candidato.
  async obterAtual(client: PoolClient, tenantId: string, applicationId: string): Promise<CandidateSummaryDraft | null> {
    const result = await client.query<{ id: string; frases: FraseResumo[]; criado_em: Date }>(
      `SELECT id, frases, criado_em FROM candidate_summary_draft
       WHERE tenant_id = $1 AND application_id = $2 AND aplicado_em IS NOT NULL
       ORDER BY aplicado_em DESC LIMIT 1`,
      [tenantId, applicationId],
    );
    if (result.rows.length === 0) return null;
    return { id: result.rows[0].id, applicationId, frases: result.rows[0].frases, criadoEm: result.rows[0].criado_em };
  }
}

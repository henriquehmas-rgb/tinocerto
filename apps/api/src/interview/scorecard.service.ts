import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CerbosService } from '../authz/cerbos.service';

export interface ScorecardSubmissaoInput {
  tenantId: string;
  interviewScheduleId: string;
  avaliadorId: string;
  notasPorCompetencia: Record<string, number>;
  comentario?: string;
}

export interface ScorecardRow {
  id: string;
  interviewScheduleId: string;
  avaliadorId: string;
  notasPorCompetencia: Record<string, number>;
  comentario: string | null;
  submetidoEm: string | null;
}

interface PrincipalMinimo {
  id: string;
  roles: string[];
}

// [Fix 7 da revisão final -- decisão de produto] Scorecard fica imutável
// após submetido: um avaliador não pode reenviar com notas diferentes
// depois de ter espiado a nota já submetida de um colega (a UPSERT
// incondicional de antes permitia isso silenciosamente, inclusive
// sobrescrevendo submetido_em sem deixar rastro).
export class ScorecardJaSubmetidoError extends Error {}

// [Fix round 1 -- achado incidental da revisão da vulnerabilidade
// introduzida pela onda 3] `trg_scorecard_avaliador_e_evaluator`
// (interview_0006__scorecard.sql) rejeita via RAISE EXCEPTION um
// INSERT/UPDATE de scorecard cujo avaliador_id não está cadastrado como
// interview_evaluator daquela interview_schedule_id específica -- cenário
// possível para um recrutador com posse REAL da vaga (passa pela guarda de
// ScorecardController.exigirPosseDaEntrevista) mas que nunca foi designado
// avaliador daquela entrevista. RAISE EXCEPTION sem SQLSTATE explícito usa
// o código default P0001 (raise_exception) -- sem este catch, o erro cru
// do Postgres (500) vazava para o cliente.
export class AvaliadorNaoEhInterviewEvaluatorError extends Error {}

function isAvaliadorNaoEvaluatorViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P0001' &&
    typeof (err as { message?: unknown }).message === 'string' &&
    (err as { message: string }).message.includes('não está cadastrado como interview_evaluator desta entrevista')
  );
}

@Injectable()
export class ScorecardService {
  constructor(private readonly cerbosService: CerbosService) {}

  async submeter(client: PoolClient, input: ScorecardSubmissaoInput): Promise<{ id: string }> {
    // [Fix 7 da revisão final] `DO UPDATE ... WHERE scorecard.submetido_em
    // IS NULL` em vez de um SELECT-então-decide: Postgres pula o UPDATE (e
    // omite a linha de RETURNING) atomicamente quando a condição falha,
    // fechando a race que um check-then-write deixaria aberta sob
    // tentativas concorrentes de submissão. Num INSERT novo (sem conflito
    // ainda) o WHERE nem se aplica -- só rege o ramo de conflito/update --
    // então RETURNING sempre produz uma linha para um insert genuíno.
    let result;
    try {
      result = await client.query<{ id: string }>(
        `INSERT INTO scorecard (tenant_id, interview_schedule_id, avaliador_id, notas_por_competencia, comentario, submetido_em)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (tenant_id, interview_schedule_id, avaliador_id)
         DO UPDATE SET notas_por_competencia = EXCLUDED.notas_por_competencia,
                        comentario = EXCLUDED.comentario,
                        submetido_em = now()
         WHERE scorecard.submetido_em IS NULL
         RETURNING id`,
        [
          input.tenantId,
          input.interviewScheduleId,
          input.avaliadorId,
          JSON.stringify(input.notasPorCompetencia),
          input.comentario ?? null,
        ],
      );
    } catch (err) {
      if (isAvaliadorNaoEvaluatorViolation(err)) {
        throw new AvaliadorNaoEhInterviewEvaluatorError((err as { message: string }).message);
      }
      throw err;
    }
    if (result.rows.length === 0) {
      throw new ScorecardJaSubmetidoError(
        `scorecard do avaliador ${input.avaliadorId} para a entrevista ${input.interviewScheduleId} já foi submetido e não pode ser alterado`,
      );
    }
    return { id: result.rows[0].id };
  }

  async listarPorEntrevista(
    client: PoolClient,
    tenantId: string,
    interviewScheduleId: string,
    principal: PrincipalMinimo,
  ): Promise<ScorecardRow[]> {
    const rows = await client.query<{
      id: string | null;
      interview_schedule_id: string;
      avaliador_id: string;
      notas_por_competencia: Record<string, number> | null;
      comentario: string | null;
      submetido_em: string | null;
    }>(
      `SELECT s.id, ie.interview_schedule_id, ie.user_id AS avaliador_id,
              s.notas_por_competencia, s.comentario, s.submetido_em
         FROM interview_evaluator ie
         LEFT JOIN scorecard s
           ON s.tenant_id = ie.tenant_id
          AND s.interview_schedule_id = ie.interview_schedule_id
          AND s.avaliador_id = ie.user_id
        WHERE ie.tenant_id = $1 AND ie.interview_schedule_id = $2`,
      [tenantId, interviewScheduleId],
    );

    // [Fix 4 da revisão final] Mapa com uma entrada por avaliador DESTA
    // entrevista -- nunca esparso em relação aos avaliadores, mas também
    // nunca vai conter uma entrada para um principal que não seja avaliador
    // (ex.: um recrutador consultando esta lista). A policy
    // (resource_scorecard.yaml) usa o operador `in` do CEL para checar
    // pertencimento antes de indexar por request.principal.id -- é isso
    // que torna a expressão bem definida (total) para qualquer principal
    // que alcance esta checagem, não só para avaliadores.
    const submetidoPor: Record<string, boolean> = {};
    for (const row of rows.rows) {
      submetidoPor[row.avaliador_id] = row.submetido_em != null;
    }

    const visiveis: ScorecardRow[] = [];
    for (const row of rows.rows) {
      if (!row.id) continue; // avaliador ainda sem scorecard -- nada a mostrar
      const decision = await this.cerbosService.check(
        { id: principal.id, roles: principal.roles, attr: { tenant_id: tenantId } },
        {
          kind: 'scorecard',
          id: row.id,
          attr: {
            tenant_id: tenantId,
            avaliador_id: row.avaliador_id,
            submetido_em: row.submetido_em,
            submetido_por: submetidoPor,
          },
        },
        ['read'],
      );
      if (decision.read) {
        visiveis.push({
          id: row.id,
          interviewScheduleId: row.interview_schedule_id,
          avaliadorId: row.avaliador_id,
          notasPorCompetencia: row.notas_por_competencia!,
          comentario: row.comentario,
          submetidoEm: row.submetido_em,
        });
      }
    }
    return visiveis;
  }
}

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

@Injectable()
export class ScorecardService {
  constructor(private readonly cerbosService: CerbosService) {}

  async submeter(client: PoolClient, input: ScorecardSubmissaoInput): Promise<{ id: string }> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO scorecard (tenant_id, interview_schedule_id, avaliador_id, notas_por_competencia, comentario, submetido_em)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (tenant_id, interview_schedule_id, avaliador_id)
       DO UPDATE SET notas_por_competencia = EXCLUDED.notas_por_competencia,
                      comentario = EXCLUDED.comentario,
                      submetido_em = now()
       RETURNING id`,
      [
        input.tenantId,
        input.interviewScheduleId,
        input.avaliadorId,
        JSON.stringify(input.notasPorCompetencia),
        input.comentario ?? null,
      ],
    );
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

    // Mapa COMPLETO -- uma entrada por avaliador desta entrevista, nunca
    // esparso (indexar chave ausente de mapa em CEL do Cerbos lança erro
    // em runtime em vez de devolver falso -- ver resource_scorecard.yaml).
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

import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface EtapaPercorrida {
  deEtapa: string | null;
  paraEtapa: string;
  em: string;
}

export interface DecisaoView {
  tipo: 'aprovacao' | 'reprovacao' | 'oferta';
  motivoCodigo: string | null;
  decididoEm: string;
  revisaoSolicitada: boolean;
  revisaoSolicitadaEm: string | null;
  podeSolicitarRevisao: boolean;
}

export interface OfertaView {
  status: 'estendida' | 'aceita' | 'recusada';
  valor: string;
  moeda: string;
  estendidoEm: string;
  respondidoEm: string | null;
}

export interface CandidateEvaluationView {
  applicationId: string;
  etapasPercorridas: EtapaPercorrida[];
  decisao: DecisaoView | null;
  oferta: OfertaView | null;
}

@Injectable()
export class CandidateEvaluationViewService {
  // Nunca faz JOIN com scorecard/interview_evaluator/laudo_psicologico --
  // não é uma omissão de campo, é ausência ESTRUTURAL: esta classe não tem
  // nenhuma query capaz de devolver conteúdo bruto de avaliação de um
  // avaliador. Ver design spec §Arquitetura item 4 para o raciocínio
  // campo a campo completo (o que é exposto e por quê, o que nunca é e
  // por quê).
  async build(client: PoolClient, tenantId: string, applicationId: string): Promise<CandidateEvaluationView> {
    const transitions = await client.query<{ from_state: string | null; to_state: string; occurred_at: string }>(
      `SELECT from_state, to_state, occurred_at
         FROM pipeline_stage_transition
        WHERE tenant_id = $1 AND application_id = $2
        ORDER BY occurred_at ASC`,
      [tenantId, applicationId],
    );

    const decisionRow = await client.query<{
      tipo: 'aprovacao' | 'reprovacao' | 'oferta';
      motivo_codigo: string | null;
      criado_em: string;
      revisao_solicitada: boolean;
      revisao_solicitada_em: string | null;
    }>(
      `SELECT tipo, motivo_codigo, criado_em, revisao_solicitada, revisao_solicitada_em
         FROM decision
        WHERE tenant_id = $1 AND application_id = $2
        ORDER BY criado_em DESC LIMIT 1`,
      [tenantId, applicationId],
    );

    const offerRow = await client.query<{
      status: 'estendida' | 'aceita' | 'recusada';
      valor: string;
      moeda: string;
      estendido_em: string;
      respondido_em: string | null;
    }>(
      `SELECT status, valor, moeda, estendido_em, respondido_em
         FROM offer
        WHERE tenant_id = $1 AND application_id = $2
        ORDER BY estendido_em DESC LIMIT 1`,
      [tenantId, applicationId],
    );

    const decisao = decisionRow.rows[0]
      ? {
          tipo: decisionRow.rows[0].tipo,
          motivoCodigo: decisionRow.rows[0].motivo_codigo,
          decididoEm: decisionRow.rows[0].criado_em,
          revisaoSolicitada: decisionRow.rows[0].revisao_solicitada,
          revisaoSolicitadaEm: decisionRow.rows[0].revisao_solicitada_em,
          podeSolicitarRevisao: decisionRow.rows[0].tipo === 'reprovacao' && !decisionRow.rows[0].revisao_solicitada,
        }
      : null;

    const oferta = offerRow.rows[0]
      ? {
          status: offerRow.rows[0].status,
          valor: offerRow.rows[0].valor,
          moeda: offerRow.rows[0].moeda,
          estendidoEm: offerRow.rows[0].estendido_em,
          respondidoEm: offerRow.rows[0].respondido_em,
        }
      : null;

    return {
      applicationId,
      etapasPercorridas: transitions.rows.map((row) => ({ deEtapa: row.from_state, paraEtapa: row.to_state, em: row.occurred_at })),
      decisao,
      oferta,
    };
  }
}

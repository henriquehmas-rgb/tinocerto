import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';

export interface RecordDecisionInput {
  tenantId: string;
  applicationId: string;
  tipo: 'aprovacao' | 'reprovacao' | 'oferta';
  motivoCodigo?: string;
  decidoPor: string;
}

export interface RevisaoPendenteRow {
  id: string;
  applicationId: string;
  tipo: 'aprovacao' | 'reprovacao' | 'oferta';
  motivoCodigo: string | null;
  decididoPor: string;
  revisaoSolicitadaEm: string | null;
  criadoEm: string;
}

export class DecisaoNaoEncontradaError extends Error {}
export class RevisaoJaSolicitadaError extends Error {}

@Injectable()
export class DecisionService {
  constructor(private readonly outbox: OutboxService) {}

  async record(client: PoolClient, input: RecordDecisionInput): Promise<{ id: string }> {
    if (!input.decidoPor) {
      throw new Error('decidoPor é obrigatório — nenhuma decisão pode ser registrada sem um usuário autenticado');
    }

    const result = await client.query<{ id: string }>(
      `INSERT INTO decision (tenant_id, application_id, tipo, motivo_codigo, decidido_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.tenantId, input.applicationId, input.tipo, input.motivoCodigo ?? null, input.decidoPor],
    );
    const id = result.rows[0].id;

    if (input.tipo === 'reprovacao') {
      const sequence = await nextOutboxSequence(client, input.applicationId);
      await this.outbox.write(client, {
        tenantId: input.tenantId,
        aggregateType: 'application',
        aggregateId: input.applicationId,
        eventType: 'application.rejected',
        sequence,
        payload: {
          application_id: input.applicationId,
          reason_code: input.motivoCodigo ?? null,
          // Sempre true nesta fase -- ver comentário no teste.
          review_requestable: true,
        },
        occurredAt: new Date(),
      });
    }

    return { id };
  }

  // Aciona-se pelo lado do candidato (candidate-auth) -- é um direito do
  // titular (LGPD art. 20 / GDPR art. 22(3)), não uma ferramenta
  // operacional de recrutador. Restrito a tipo = 'reprovacao': uma oferta
  // recusada ou uma aprovação não são decisões adversas automatizadas
  // contra o candidato, não fazem sentido nesta fila. Ver design spec
  // §Decisões fechadas, item 5.
  async solicitarRevisao(client: PoolClient, tenantId: string, decisionId: string): Promise<{ id: string }> {
    const result = await client.query<{ id: string }>(
      `UPDATE decision
          SET revisao_solicitada = true, revisao_solicitada_em = now()
        WHERE tenant_id = $1 AND id = $2 AND tipo = 'reprovacao' AND revisao_solicitada = false
        RETURNING id`,
      [tenantId, decisionId],
    );
    if (result.rows.length > 0) {
      return { id: result.rows[0].id };
    }

    // Distingue "não existe/não é reprovação" de "já solicitada" com uma
    // segunda consulta de diagnóstico -- mesma disciplina de erro
    // específico já usada em OfferService.
    const existing = await client.query<{ id: string; tipo: string; revisao_solicitada: boolean }>(
      `SELECT id, tipo, revisao_solicitada FROM decision WHERE tenant_id = $1 AND id = $2`,
      [tenantId, decisionId],
    );
    if (existing.rows.length === 0 || existing.rows[0].tipo !== 'reprovacao') {
      throw new DecisaoNaoEncontradaError(`decisão de reprovação ${decisionId} não encontrada`);
    }
    throw new RevisaoJaSolicitadaError(`revisão já foi solicitada para a decisão ${decisionId}`);
  }

  async listarRevisoesPendentes(client: PoolClient, tenantId: string): Promise<RevisaoPendenteRow[]> {
    const result = await client.query<{
      id: string;
      application_id: string;
      tipo: 'aprovacao' | 'reprovacao' | 'oferta';
      motivo_codigo: string | null;
      decidido_por: string;
      revisao_solicitada_em: string | null;
      criado_em: string;
    }>(
      `SELECT id, application_id, tipo, motivo_codigo, decidido_por, revisao_solicitada_em, criado_em
         FROM decision
        WHERE tenant_id = $1 AND revisao_solicitada = true
        ORDER BY revisao_solicitada_em ASC NULLS LAST`,
      [tenantId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      applicationId: row.application_id,
      tipo: row.tipo,
      motivoCodigo: row.motivo_codigo,
      decididoPor: row.decidido_por,
      revisaoSolicitadaEm: row.revisao_solicitada_em,
      criadoEm: row.criado_em,
    }));
  }
}

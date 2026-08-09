import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';
import { DecisionService } from './decision.service';

export interface ExtendOfferInput {
  tenantId: string;
  applicationId: string;
  valor: string; // numeric em string -- evita perda de precisão em valor monetário
  estendidoPor: string;
}

export interface RespondOfferInput {
  tenantId: string;
  offerId: string;
  respondidoPor: string;
  motivoRecusaCodigo?: string;
}

export interface OfferRow {
  id: string;
  applicationId: string;
  valor: string;
  moeda: string;
  status: 'estendida' | 'aceita' | 'recusada';
  estendidoPor: string;
  estendidoEm: string;
  respondidoPor: string | null;
  respondidoEm: string | null;
  motivoRecusaCodigo: string | null;
}

export class OfertaPendenteExistenteError extends Error {}
export class OfertaNaoEncontradaError extends Error {}
export class OfertaJaRespondidaError extends Error {}

function isUniqueViolation(err: unknown, indexName: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === '23505' &&
    (err as { constraint?: unknown }).constraint === indexName
  );
}

@Injectable()
export class OfferService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly decisionService: DecisionService,
  ) {}

  async extend(client: PoolClient, input: ExtendOfferInput): Promise<{ id: string }> {
    let offerId: string;
    try {
      const result = await client.query<{ id: string }>(
        `INSERT INTO offer (tenant_id, application_id, valor, estendido_por)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [input.tenantId, input.applicationId, input.valor, input.estendidoPor],
      );
      offerId = result.rows[0].id;
    } catch (err) {
      if (isUniqueViolation(err, 'uq_offer_tenant_application_pendente')) {
        throw new OfertaPendenteExistenteError(
          `candidatura ${input.applicationId} já tem uma oferta pendente de resposta -- registre a resposta antes de estender uma nova`,
        );
      }
      throw err;
    }

    // Mantém o diário de decisões (decision.tipo = 'oferta', previsto no
    // schema desde a Fase 1 -- hiring_0006__decision.sql -- sem consumidor
    // até esta fase) coerente com a entidade rica nova. Não gera evento
    // próprio (DecisionService.record só emite outbox para 'reprovacao');
    // o evento rico de oferta é responsabilidade deste serviço, abaixo.
    await this.decisionService.record(client, {
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      tipo: 'oferta',
      decidoPor: input.estendidoPor,
    });

    const sequence = await nextOutboxSequence(client, input.applicationId);
    await this.outbox.write(client, {
      tenantId: input.tenantId,
      aggregateType: 'application',
      aggregateId: input.applicationId,
      eventType: 'offer.extended',
      sequence,
      payload: { application_id: input.applicationId, offer_id: offerId, valor: input.valor },
      occurredAt: new Date(),
    });

    return { id: offerId };
  }

  async accept(client: PoolClient, input: RespondOfferInput): Promise<{ id: string; applicationId: string }> {
    return this.respond(client, input, 'aceita', 'offer.accepted');
  }

  async decline(client: PoolClient, input: RespondOfferInput): Promise<{ id: string; applicationId: string }> {
    return this.respond(client, input, 'recusada', 'offer.declined');
  }

  private async respond(
    client: PoolClient,
    input: RespondOfferInput,
    novoStatus: 'aceita' | 'recusada',
    eventType: 'offer.accepted' | 'offer.declined',
  ): Promise<{ id: string; applicationId: string }> {
    const existing = await client.query<{ id: string; application_id: string; status: string }>(
      `SELECT id, application_id, status FROM offer WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.offerId],
    );
    if (existing.rows.length === 0) {
      throw new OfertaNaoEncontradaError(`oferta ${input.offerId} não encontrada`);
    }
    if (existing.rows[0].status !== 'estendida') {
      throw new OfertaJaRespondidaError(
        `oferta ${input.offerId} já foi respondida (status atual: ${existing.rows[0].status})`,
      );
    }
    const applicationId = existing.rows[0].application_id;

    const updated = await client.query<{ id: string }>(
      `UPDATE offer
          SET status = $1, respondido_por = $2, respondido_em = now(), motivo_recusa_codigo = $3
        WHERE tenant_id = $4 AND id = $5 AND status = 'estendida'
        RETURNING id`,
      [novoStatus, input.respondidoPor, input.motivoRecusaCodigo ?? null, input.tenantId, input.offerId],
    );
    if (updated.rows.length === 0) {
      // Corrida: outra requisição respondeu entre o SELECT e o UPDATE acima
      // -- o WHERE condicional é a fonte de verdade atômica, a checagem em
      // memória logo acima só existe para dar erro melhor no caminho feliz.
      throw new OfertaJaRespondidaError(`oferta ${input.offerId} já foi respondida por outra requisição concorrente`);
    }

    const sequence = await nextOutboxSequence(client, applicationId);
    const payload: Record<string, unknown> = { application_id: applicationId, offer_id: input.offerId };
    if (eventType === 'offer.declined') {
      payload.motivo_codigo = input.motivoRecusaCodigo ?? null;
    }
    await this.outbox.write(client, {
      tenantId: input.tenantId,
      aggregateType: 'application',
      aggregateId: applicationId,
      eventType,
      sequence,
      payload,
      occurredAt: new Date(),
    });

    return { id: input.offerId, applicationId };
  }

  // Item 1 da onda 3 de correcao pos-revisao: accept/decline no controller
  // recebem so o offerId na URL (sem jobId direto) -- precisa resolver
  // offer.id -> application_id -> job_id antes de checar posse por
  // recrutador. Mesmo raciocinio de application.controller.ts: buscar
  // antes, checar posse, so entao prosseguir.
  async buscarJobId(client: PoolClient, tenantId: string, offerId: string): Promise<string | null> {
    const result = await client.query<{ job_id: string }>(
      `SELECT a.job_id
         FROM offer o
         JOIN application a ON a.tenant_id = o.tenant_id AND a.id = o.application_id
        WHERE o.tenant_id = $1 AND o.id = $2`,
      [tenantId, offerId],
    );
    return result.rows[0]?.job_id ?? null;
  }

  async listByApplication(client: PoolClient, tenantId: string, applicationId: string): Promise<OfferRow[]> {
    const result = await client.query<{
      id: string;
      application_id: string;
      valor: string;
      moeda: string;
      status: 'estendida' | 'aceita' | 'recusada';
      estendido_por: string;
      estendido_em: string;
      respondido_por: string | null;
      respondido_em: string | null;
      motivo_recusa_codigo: string | null;
    }>(
      `SELECT id, application_id, valor, moeda, status, estendido_por, estendido_em, respondido_por, respondido_em, motivo_recusa_codigo
         FROM offer
        WHERE tenant_id = $1 AND application_id = $2
        ORDER BY estendido_em DESC`,
      [tenantId, applicationId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      applicationId: row.application_id,
      valor: row.valor,
      moeda: row.moeda,
      status: row.status,
      estendidoPor: row.estendido_por,
      estendidoEm: row.estendido_em,
      respondidoPor: row.respondido_por,
      respondidoEm: row.respondido_em,
      motivoRecusaCodigo: row.motivo_recusa_codigo,
    }));
  }
}

import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';

export interface CreateApplicationInput {
  tenantId: string;
  jobId: string;
  personId: string;
  touchpointId?: string;
}

export interface ApplicationWithPersonView {
  id: string;
  jobId: string;
  etapaFunil: string;
  criadoEm: Date;
  person: {
    id: string;
    nome: string;
    emailPrincipal: string;
  };
}

export interface ApplicationListItem {
  id: string;
  jobId: string;
  candidateId: string;
  stage: string;
  createdAt: Date;
}

export interface ListByCursorInput {
  jobId?: string;
  stage?: string;
  limit: number;
  cursor?: { sortValue: string; id: string };
}

export interface ListByCursorResult {
  items: ApplicationListItem[];
  hasMore: boolean;
}

@Injectable()
export class ApplicationService {
  constructor(private readonly outbox: OutboxService) {}

  async create(client: PoolClient, input: CreateApplicationInput): Promise<{ id: string }> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id, touchpoint_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.tenantId, input.jobId, input.personId, input.touchpointId ?? null],
    );
    const id = result.rows[0].id;

    const sequence = await nextOutboxSequence(client, id);
    await this.outbox.write(client, {
      tenantId: input.tenantId,
      aggregateType: 'application',
      aggregateId: id,
      eventType: 'application.created',
      sequence,
      payload: { application_id: id, job_id: input.jobId, person_id: input.personId, touchpoint_id: input.touchpointId ?? null },
      occurredAt: new Date(),
    });

    return { id };
  }

  /**
   * PersonView projetado -- nunca retorna o agregado Person cru (nunca
   * cpf_hash/cpf_encriptado). É o ÚNICO caminho por onde este domínio
   * expõe dado de person para fora, conforme 03-arquitetura-e-modelo-de-
   * dados.md §2.3 ("o tenant nunca consulta Person diretamente").
   */
  async findByIdWithPersonView(client: PoolClient, id: string): Promise<ApplicationWithPersonView | null> {
    const result = await client.query<{
      id: string;
      job_id: string;
      etapa_funil: string;
      criado_em: Date;
      person_id: string;
      nome: string;
      email_principal: string;
    }>(
      `SELECT a.id, a.job_id, a.etapa_funil, a.criado_em, p.id AS person_id, p.nome, p.email_principal
       FROM application a
       JOIN person p ON p.id = a.person_id
       WHERE a.id = $1`,
      [id],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      jobId: row.job_id,
      etapaFunil: row.etapa_funil,
      criadoEm: row.criado_em,
      person: {
        id: row.person_id,
        nome: row.nome,
        emailPrincipal: row.email_principal,
      },
    };
  }

  async updateStage(client: PoolClient, id: string, newStage: string): Promise<{ tenantId: string; previousStage: string }> {
    const current = await client.query<{ tenant_id: string; etapa_funil: string }>(
      `SELECT tenant_id, etapa_funil FROM application WHERE id = $1`,
      [id],
    );
    if (current.rows.length === 0) {
      throw new Error(`Candidatura ${id} não encontrada`);
    }
    await client.query(`UPDATE application SET etapa_funil = $1 WHERE id = $2`, [newStage, id]);
    return { tenantId: current.rows[0].tenant_id, previousStage: current.rows[0].etapa_funil };
  }

  // Superfície pública da Plataforma API (GET /v1/applications, Fase 4a).
  // Devolve só id/job_id/candidate_id/stage/created_at -- NUNCA nome/e-mail
  // do candidato (ver PersonView em findByIdWithPersonView acima; aqui nem
  // isso, só o person_id como "candidate_id" de referência, mesmo shape do
  // exemplo do doc 04 §2.2). adherence_score/assessment_status/source do
  // exemplo aspiracional do doc 04 ficam de fora -- dependem de outros
  // domínios (Matching/Assessment/candidate_touchpoint) que esta fatia não
  // toca; documentado como extensão futura aditiva na design spec.
  //
  // Sem parâmetro tenantId de propósito -- mesma convenção de
  // findByIdWithPersonView acima: é uma LEITURA, a RLS do `client` (já
  // escopado por TenantContext.run antes de chegar aqui) é a única
  // fronteira de tenant que a query precisa. tenantId só aparece como
  // parâmetro em métodos de ESCRITA (ex.: create), porque um INSERT
  // precisa do valor explícito para a coluna, RLS não supre isso sozinha.
  async listByCursor(client: PoolClient, input: ListByCursorInput): Promise<ListByCursorResult> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (input.jobId) {
      values.push(input.jobId);
      conditions.push(`a.job_id = $${values.length}`);
    }
    if (input.stage) {
      values.push(input.stage);
      conditions.push(`a.etapa_funil = $${values.length}`);
    }
    if (input.cursor) {
      values.push(input.cursor.sortValue, input.cursor.id);
      conditions.push(`(a.criado_em, a.id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(input.limit + 1); // busca 1 a mais para saber has_more sem COUNT(*)

    const result = await client.query<{
      id: string;
      job_id: string;
      candidate_id: string;
      stage: string;
      criado_em: Date;
    }>(
      `SELECT a.id, a.job_id, a.person_id AS candidate_id, a.etapa_funil AS stage, a.criado_em
         FROM application a
         ${where}
        ORDER BY a.criado_em ASC, a.id ASC
        LIMIT $${values.length}`,
      values,
    );

    const hasMore = result.rows.length > input.limit;
    const rows = result.rows.slice(0, input.limit);

    return {
      items: rows.map((row) => ({
        id: row.id,
        jobId: row.job_id,
        candidateId: row.candidate_id,
        stage: row.stage,
        createdAt: row.criado_em,
      })),
      hasMore,
    };
  }
}

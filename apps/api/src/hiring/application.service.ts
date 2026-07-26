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
}

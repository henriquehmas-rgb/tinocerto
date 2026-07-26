import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';
import { generateSeoSlug } from './seo-slug';
import { RequisitionService } from './requisition.service';

export interface CreateJobInput {
  tenantId: string;
  requisitionId: string;
  titulo: string;
}

@Injectable()
export class JobService {
  private readonly outbox = new OutboxService();

  constructor(private readonly requisitionService: RequisitionService) {}

  async create(client: PoolClient, input: CreateJobInput): Promise<{ id: string }> {
    const requisition = await this.requisitionService.findById(client, input.requisitionId);
    if (!requisition || requisition.tenantId !== input.tenantId) {
      throw new Error(`Requisição ${input.requisitionId} não encontrada para este tenant`);
    }
    if (requisition.status !== 'aprovada') {
      throw new Error(`Requisição ${input.requisitionId} precisa estar aprovada antes de criar uma vaga`);
    }

    const result = await client.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, $3, '') RETURNING id`,
      [input.tenantId, input.requisitionId, input.titulo],
    );
    const id = result.rows[0].id;
    const seoSlug = generateSeoSlug(input.titulo, id);
    await client.query(`UPDATE job SET seo_slug = $1 WHERE id = $2`, [seoSlug, id]);

    return { id };
  }

  async publish(client: PoolClient, id: string, canais: string[]): Promise<void> {
    const current = await client.query<{ tenant_id: string; publicado_em: Date | null }>(
      `SELECT tenant_id, publicado_em FROM job WHERE id = $1`,
      [id],
    );
    if (current.rows.length === 0) {
      throw new Error(`Vaga ${id} não encontrada`);
    }
    if (current.rows[0].publicado_em !== null) {
      throw new Error(`Vaga ${id} já está publicada`);
    }

    await client.query(`UPDATE job SET publicado_em = now(), canais = $1 WHERE id = $2`, [canais, id]);

    const sequence = await nextOutboxSequence(client, id);
    await this.outbox.write(client, {
      tenantId: current.rows[0].tenant_id,
      aggregateType: 'job',
      aggregateId: id,
      eventType: 'job.published',
      sequence,
      payload: { job_id: id, canais },
      occurredAt: new Date(),
    });
  }
}

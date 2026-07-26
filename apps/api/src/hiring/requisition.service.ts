import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';

export interface OpenRequisitionInput {
  tenantId: string;
  orgUnitId: string;
  titulo: string;
}

export interface RequisitionRecord {
  id: string;
  tenantId: string;
  orgUnitId: string;
  titulo: string;
  status: 'aberta' | 'aprovada' | 'fechada';
  openedAt: Date;
  approvedAt: Date | null;
  closedAt: Date | null;
}

@Injectable()
export class RequisitionService {
  private readonly outbox = new OutboxService();

  async open(client: PoolClient, input: OpenRequisitionInput): Promise<{ id: string }> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo) VALUES ($1, $2, $3) RETURNING id`,
      [input.tenantId, input.orgUnitId, input.titulo],
    );
    const id = result.rows[0].id;

    const sequence = await nextOutboxSequence(client, id);
    await this.outbox.write(client, {
      tenantId: input.tenantId,
      aggregateType: 'requisition',
      aggregateId: id,
      eventType: 'requisition.opened',
      sequence,
      payload: { requisition_id: id, org_unit_id: input.orgUnitId },
      occurredAt: new Date(),
    });

    return { id };
  }

  async approve(client: PoolClient, id: string, approvedBy: string): Promise<void> {
    const current = await client.query<{ tenant_id: string; status: string }>(
      `SELECT tenant_id, status FROM requisition WHERE id = $1`,
      [id],
    );
    if (current.rows.length === 0) {
      throw new Error(`Requisição ${id} não encontrada`);
    }
    if (current.rows[0].status !== 'aberta') {
      throw new Error(`Requisição ${id} não pode ser aprovada (status atual: ${current.rows[0].status})`);
    }

    await client.query(`UPDATE requisition SET status = 'aprovada', approved_at = now() WHERE id = $1`, [id]);

    const sequence = await nextOutboxSequence(client, id);
    await this.outbox.write(client, {
      tenantId: current.rows[0].tenant_id,
      aggregateType: 'requisition',
      aggregateId: id,
      eventType: 'requisition.approved',
      sequence,
      payload: { requisition_id: id, approved_by: approvedBy },
      occurredAt: new Date(),
    });
  }

  async findById(client: PoolClient, id: string): Promise<RequisitionRecord | null> {
    const result = await client.query<{
      id: string;
      tenant_id: string;
      org_unit_id: string;
      titulo: string;
      status: 'aberta' | 'aprovada' | 'fechada';
      opened_at: Date;
      approved_at: Date | null;
      closed_at: Date | null;
    }>(`SELECT * FROM requisition WHERE id = $1`, [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      orgUnitId: row.org_unit_id,
      titulo: row.titulo,
      status: row.status,
      openedAt: row.opened_at,
      approvedAt: row.approved_at,
      closedAt: row.closed_at,
    };
  }
}

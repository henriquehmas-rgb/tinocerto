import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';

export interface AuditLogEntryInput {
  tenantId: string;
  actorId?: string;
  actorType: string;
  onBehalfOf?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  fieldsRead?: string[];
  ip?: string;
  userAgent?: string;
  requestId?: string;
  occurredAt: Date;
}

@Injectable()
export class AuditLogService {
  async append(client: PoolClient, entry: AuditLogEntryInput): Promise<void> {
    const last = await client.query<{ hash: string }>(
      `SELECT hash FROM audit_log_entry WHERE tenant_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [entry.tenantId],
    );
    const prevHash = last.rows[0]?.hash ?? null;

    const canonical = [
      prevHash ?? '',
      entry.tenantId,
      entry.actorId ?? '',
      entry.actorType,
      entry.action,
      entry.resourceType,
      entry.resourceId ?? '',
      entry.occurredAt.toISOString(),
    ].join('|');

    const hash = createHash('sha256').update(canonical).digest('hex');

    await client.query(
      `INSERT INTO audit_log_entry
         (tenant_id, actor_id, actor_type, on_behalf_of, action, resource_type, resource_id,
          fields_read, ip, user_agent, request_id, occurred_at, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        entry.tenantId,
        entry.actorId ?? null,
        entry.actorType,
        entry.onBehalfOf ?? null,
        entry.action,
        entry.resourceType,
        entry.resourceId ?? null,
        entry.fieldsRead ?? null,
        entry.ip ?? null,
        entry.userAgent ?? null,
        entry.requestId ?? null,
        entry.occurredAt,
        prevHash,
        hash,
      ],
    );
  }
}

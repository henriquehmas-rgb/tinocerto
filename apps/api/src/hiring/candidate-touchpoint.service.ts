import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface RecordTouchpointInput {
  tenantId: string;
  personId: string;
  canal: string;
  campanha?: string;
}

@Injectable()
export class CandidateTouchpointService {
  async record(client: PoolClient, input: RecordTouchpointInput): Promise<{ id: string }> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO candidate_touchpoint (tenant_id, person_id, canal, campanha) VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.tenantId, input.personId, input.canal, input.campanha ?? null],
    );
    return { id: result.rows[0].id };
  }
}

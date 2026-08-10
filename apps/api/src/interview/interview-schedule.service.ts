import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface InterviewScheduleCriarInput {
  tenantId: string;
  applicationId: string;
  interviewGuideVersionId: string;
  dataHora: Date;
  avaliadorIds: string[];
}

@Injectable()
export class InterviewScheduleService {
  async criar(client: PoolClient, input: InterviewScheduleCriarInput): Promise<{ id: string }> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO interview_schedule (tenant_id, application_id, interview_guide_version_id, data_hora)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.tenantId, input.applicationId, input.interviewGuideVersionId, input.dataHora],
    );
    const scheduleId = result.rows[0].id;
    for (const userId of input.avaliadorIds) {
      await client.query(
        `INSERT INTO interview_evaluator (tenant_id, interview_schedule_id, user_id) VALUES ($1, $2, $3)`,
        [input.tenantId, scheduleId, userId],
      );
    }
    return { id: scheduleId };
  }

  async obterPorCandidatura(
    client: PoolClient,
    tenantId: string,
    applicationId: string,
  ): Promise<{ id: string; dataHora: Date; status: string } | null> {
    const result = await client.query<{ id: string; data_hora: Date; status: string }>(
      `SELECT id, data_hora, status FROM interview_schedule
       WHERE tenant_id = $1 AND application_id = $2 ORDER BY criado_em DESC LIMIT 1`,
      [tenantId, applicationId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { id: row.id, dataHora: row.data_hora, status: row.status };
  }
}

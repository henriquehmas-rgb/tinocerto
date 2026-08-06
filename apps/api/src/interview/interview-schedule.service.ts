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
}

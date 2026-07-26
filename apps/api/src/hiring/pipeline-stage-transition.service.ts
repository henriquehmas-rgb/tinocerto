import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';
import { ApplicationService } from './application.service';

export interface MoveStageInput {
  applicationId: string;
  toState: string;
  reasonCode?: string;
  actorId: string;
  actorType: string;
  onBehalfOf?: string;
}

@Injectable()
export class PipelineStageTransitionService {
  constructor(
    private readonly applicationService: ApplicationService,
    private readonly outbox: OutboxService,
  ) {}

  async moveStage(client: PoolClient, input: MoveStageInput): Promise<{ id: string }> {
    const { tenantId, previousStage } = await this.applicationService.updateStage(
      client,
      input.applicationId,
      input.toState,
    );

    const transition = await client.query<{ id: string }>(
      `INSERT INTO pipeline_stage_transition
         (application_id, tenant_id, from_state, to_state, reason_code, actor_id, actor_type, on_behalf_of, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       RETURNING id`,
      [
        input.applicationId,
        tenantId,
        previousStage,
        input.toState,
        input.reasonCode ?? null,
        input.actorId,
        input.actorType,
        input.onBehalfOf ?? null,
      ],
    );

    const sequence = await nextOutboxSequence(client, input.applicationId);
    await this.outbox.write(client, {
      tenantId,
      aggregateType: 'application',
      aggregateId: input.applicationId,
      eventType: 'application.stage_changed',
      sequence,
      payload: {
        application_id: input.applicationId,
        from_state: previousStage,
        to_state: input.toState,
        reason_code: input.reasonCode ?? null,
      },
      occurredAt: new Date(),
    });

    return { id: transition.rows[0].id };
  }
}

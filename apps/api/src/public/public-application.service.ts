import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { CandidateTouchpointService } from '../hiring/candidate-touchpoint.service';
import { ApplicationService } from '../hiring/application.service';
import { ApplicationCustomFieldResponseService } from '../hiring/application-custom-field-response.service';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';
import { StorageService } from '../storage/storage.service';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';

const RESUME_BUCKET = process.env.MINIO_RESUME_BUCKET ?? 'curriculos';

export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export interface ApplyInput {
  tenantId: string;
  jobId: string;
  personId: string;
  curriculo: UploadedFileLike;
  respostasInscricao: { jobCustomFieldId: string; valor: string }[];
}

@Injectable()
export class PublicApplicationService {
  constructor(
    private readonly touchpointService: CandidateTouchpointService,
    private readonly applicationService: ApplicationService,
    private readonly storageService: StorageService,
    private readonly outbox: OutboxService,
    private readonly customFieldResponseService: ApplicationCustomFieldResponseService,
    private readonly encryption: EnvelopeEncryptionService,
  ) {}

  async apply(client: PoolClient, input: ApplyInput): Promise<{ applicationId: string }> {
    if (input.curriculo.mimetype !== 'application/pdf') {
      throw new Error('Currículo precisa ser um arquivo PDF');
    }

    // Upload para o MinIO acontece antes de abrir qualquer mutação de
    // banco -- ver nota de design da Task 10 sobre por que não há
    // transação distribuída entre os dois.
    const storageKey = `${input.personId}/${randomUUID()}-${input.curriculo.originalname}`;
    await this.storageService.ensureBucket(RESUME_BUCKET);
    await this.storageService.upload(RESUME_BUCKET, storageKey, input.curriculo.buffer, input.curriculo.mimetype);

    const touchpoint = await this.touchpointService.record(client, {
      tenantId: input.tenantId,
      personId: input.personId,
      canal: 'site_carreiras',
    });

    const application = await this.applicationService.create(client, {
      tenantId: input.tenantId,
      jobId: input.jobId,
      personId: input.personId,
      touchpointId: touchpoint.id,
    });

    await client.query(
      `INSERT INTO candidate_application_summary (person_id, tenant_id, application_id, job_titulo, etapa_funil)
       VALUES ($1, $2, $3, (SELECT titulo FROM job WHERE id = $4), 'triagem')
       ON CONFLICT (application_id) DO NOTHING`,
      [input.personId, input.tenantId, application.id, input.jobId],
    );

    // Reaproveita ApplicationCustomFieldResponseService (Fase 1a Task 15)
    // em vez de gravar application_custom_field_response na unha -- assim
    // a checagem de coleta faseada (rejeita responder um campo de fase
    // "admissao" aqui) e a criptografia da resposta vêm de graça, sem
    // duplicar essa lógica.
    for (const resposta of input.respostasInscricao) {
      await this.customFieldResponseService.recordResponse(client, this.encryption, {
        tenantId: input.tenantId,
        applicationId: application.id,
        jobCustomFieldId: resposta.jobCustomFieldId,
        valor: resposta.valor,
      });
    }

    const resumeUpload = await client.query<{ id: string }>(
      `INSERT INTO resume_upload (person_id, application_id, storage_key) VALUES ($1, $2, $3) RETURNING id`,
      [input.personId, application.id, storageKey],
    );
    const resumeUploadId = resumeUpload.rows[0].id;

    const sequence = await nextOutboxSequence(client, resumeUploadId);
    await this.outbox.write(client, {
      tenantId: input.tenantId,
      aggregateType: 'resume_upload',
      aggregateId: resumeUploadId,
      eventType: 'resume.uploaded',
      sequence,
      payload: { resume_upload_id: resumeUploadId, person_id: input.personId, storage_key: storageKey },
      occurredAt: new Date(),
    });

    return { applicationId: application.id };
  }
}

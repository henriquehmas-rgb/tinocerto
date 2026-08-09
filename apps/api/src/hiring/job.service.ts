import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';
import { generateSeoSlug } from './seo-slug';
import { RequisitionService } from './requisition.service';
import { JobRecrutadorService } from './job-recrutador.service';
import { classifySensitiveCategories } from './compliance/sensitive-category-linter';

export interface CreateJobInput {
  tenantId: string;
  requisitionId: string;
  titulo: string;
  habilidadesExigidas?: string[];
  recrutadorIds?: string[];
}

export interface ListarJobsInput {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

export interface JobResumo {
  id: string;
  titulo: string;
  publicadoEm: Date | null;
  criadoEm: Date;
}

export interface EditarJobInput {
  tenantId: string;
  jobId: string;
  titulo?: string;
  descricao?: string;
  habilidadesExigidas?: string[];
}

export interface CandidaturaResumo {
  id: string;
  personId: string;
  nomeCandidato: string;
  criadoEm: Date;
}

@Injectable()
export class JobService {
  private readonly outbox = new OutboxService();

  constructor(
    private readonly requisitionService: RequisitionService,
    private readonly jobRecrutadorService: JobRecrutadorService,
  ) {}

  async create(client: PoolClient, input: CreateJobInput): Promise<{ id: string }> {
    const requisition = await this.requisitionService.findById(client, input.requisitionId);
    if (!requisition || requisition.tenantId !== input.tenantId) {
      throw new Error(`Requisição ${input.requisitionId} não encontrada para este tenant`);
    }
    if (requisition.status !== 'aprovada') {
      throw new Error(`Requisição ${input.requisitionId} precisa estar aprovada antes de criar uma vaga`);
    }

    // O id é gerado na aplicação (não via DEFAULT gen_random_uuid() da coluna)
    // para que o seo_slug definitivo já esteja disponível ANTES do INSERT.
    // Isso evita o padrão "INSERT com placeholder '' + UPDATE" que fazia toda
    // criação de vaga do mesmo tenant serializar num único ponto de contenção
    // do índice único idx_job_tenant_slug (tenant_id, seo_slug): duas
    // criações concorrentes disputariam a MESMA chave (tenant_id, '') até a
    // primeira transação commitar. Com o slug final calculado antes do
    // INSERT, cada criação concorrente já insere sua própria chave distinta.
    const id = randomUUID();
    const seoSlug = generateSeoSlug(input.titulo, id);

    await client.query(
      `INSERT INTO job (id, tenant_id, requisition_id, titulo, seo_slug, habilidades_exigidas) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, input.tenantId, input.requisitionId, input.titulo, seoSlug, input.habilidadesExigidas ?? []],
    );

    await this.jobRecrutadorService.atribuir(client, {
      tenantId: input.tenantId,
      jobId: id,
      recrutadorIds: input.recrutadorIds ?? [],
    });

    return { id };
  }

  async listar(client: PoolClient, input: ListarJobsInput): Promise<JobResumo[]> {
    const somenteRecrutador =
      input.userRoles.includes('recrutador') &&
      !input.userRoles.some((papel) => ['admin_tenant', 'gestor_vaga'].includes(papel));

    const query = somenteRecrutador
      ? `SELECT j.id, j.titulo, j.publicado_em, j.criado_em FROM job j
         JOIN job_recrutador jr ON jr.job_id = j.id AND jr.tenant_id = j.tenant_id
         WHERE j.tenant_id = $1 AND jr.staff_id = $2 ORDER BY j.criado_em DESC`
      : `SELECT id, titulo, publicado_em, criado_em FROM job WHERE tenant_id = $1 ORDER BY criado_em DESC`;
    const params = somenteRecrutador ? [input.tenantId, input.userId] : [input.tenantId];

    const result = await client.query<{ id: string; titulo: string; publicado_em: Date | null; criado_em: Date }>(
      query,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      titulo: row.titulo,
      publicadoEm: row.publicado_em,
      criadoEm: row.criado_em,
    }));
  }

  async funil(client: PoolClient, input: { tenantId: string; jobId: string }): Promise<Record<string, CandidaturaResumo[]>> {
    const result = await client.query<{
      id: string;
      person_id: string;
      nome: string;
      etapa_funil: string;
      criado_em: Date;
    }>(
      `SELECT a.id, a.person_id, p.nome, a.etapa_funil, a.criado_em
       FROM application a
       JOIN person p ON p.id = a.person_id
       WHERE a.tenant_id = $1 AND a.job_id = $2
       ORDER BY a.criado_em ASC`,
      [input.tenantId, input.jobId],
    );
    const funil: Record<string, CandidaturaResumo[]> = {};
    for (const row of result.rows) {
      if (!funil[row.etapa_funil]) funil[row.etapa_funil] = [];
      funil[row.etapa_funil].push({
        id: row.id,
        personId: row.person_id,
        nomeCandidato: row.nome,
        criadoEm: row.criado_em,
      });
    }
    return funil;
  }

  async editar(client: PoolClient, input: EditarJobInput): Promise<void> {
    await client.query(
      `UPDATE job SET
         titulo = COALESCE($3, titulo),
         descricao = COALESCE($4, descricao),
         habilidades_exigidas = COALESCE($5, habilidades_exigidas)
       WHERE id = $1 AND tenant_id = $2`,
      [input.jobId, input.tenantId, input.titulo ?? null, input.descricao ?? null, input.habilidadesExigidas ?? null],
    );
  }

  async declararHabilidadesExigidas(client: PoolClient, id: string, habilidades: string[]): Promise<void> {
    const current = await client.query(`SELECT 1 FROM job WHERE id = $1`, [id]);
    if (current.rows.length === 0) {
      throw new Error(`Vaga ${id} não encontrada`);
    }
    await client.query(`UPDATE job SET habilidades_exigidas = $1 WHERE id = $2`, [habilidades, id]);
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

    const fields = await client.query<{ id: string; label: string; base_legal: string | null }>(
      `SELECT id, label, base_legal FROM job_custom_field WHERE job_id = $1`,
      [id],
    );
    for (const field of fields.rows) {
      const categories = classifySensitiveCategories(field.label);
      if (categories.length > 0 && !field.base_legal) {
        throw new Error(
          `Vaga ${id} não pode ser publicada: o campo "${field.label}" foi classificado como dado sensível (${categories.join(', ')}) e não tem base legal declarada`,
        );
      }
      if (field.base_legal === 'legitimo_interesse') {
        const lia = await client.query(`SELECT 1 FROM lia_document WHERE job_custom_field_id = $1`, [field.id]);
        if (lia.rows.length === 0) {
          throw new Error(
            `Vaga ${id} não pode ser publicada: o campo "${field.label}" declara base legal de legítimo interesse mas não tem LIA (Legitimate Interest Assessment) gerado`,
          );
        }
      }
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

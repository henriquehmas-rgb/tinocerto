import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';
import { EnvelopeEncryptionService } from '../talent/envelope-encryption.service';
import { decomporBlocoEmPares, estimarThetaEAP, ComparacaoPar, ItemNoBloco } from './scoring/mfc-scoring';

export interface ConvidarInput {
  tenantId: string;
  applicationId: string;
  personId: string;
  instrumentVersionId: string;
  nivelIntegridade?: number;
  multiplicadorTempo?: 1.0 | 1.5 | 2.0 | null;
  expiraEm?: Date;
}

export interface ResponderBlocoInput {
  assessmentApplicationId: string;
  blockId: string;
  itemIds: string[];
  maisId: string;
  menosId: string;
  duracaoMs?: number;
}

export interface ResultadoEscoragem {
  assessmentResultId: string;
  theta: Record<string, number>;
  seTheta: Record<string, number>;
}

const DIMENSOES = ['conscienciosidade', 'extroversao', 'amabilidade', 'estabilidade', 'abertura'];

@Injectable()
export class AssessmentService {
  constructor(private readonly outbox: OutboxService) {}

  async convidar(client: PoolClient, input: ConvidarInput): Promise<{ id: string }> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO assessment_application
         (tenant_id, application_id, person_id, instrument_version_id, nivel_integridade, multiplicador_tempo, expira_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        input.tenantId,
        input.applicationId,
        input.personId,
        input.instrumentVersionId,
        input.nivelIntegridade ?? 0,
        input.multiplicadorTempo ?? null,
        input.expiraEm ?? null,
      ],
    );
    const id = result.rows[0].id;

    await this.emitir(client, input.tenantId, id, 'assessment.invited', {
      assessment_application_id: id,
      application_id: input.applicationId,
      person_id: input.personId,
    });

    return { id };
  }

  async iniciar(client: PoolClient, assessmentApplicationId: string): Promise<void> {
    const atual = await client.query<{ tenant_id: string; status: string }>(
      `SELECT tenant_id, status FROM assessment_application WHERE id = $1`,
      [assessmentApplicationId],
    );
    if (atual.rows.length === 0) {
      throw new Error(`Assessment ${assessmentApplicationId} não encontrado`);
    }
    if (atual.rows[0].status !== 'convidado') {
      throw new Error(
        `Assessment ${assessmentApplicationId} não pode ser iniciado (status atual: ${atual.rows[0].status})`,
      );
    }

    await client.query(
      `UPDATE assessment_application SET status = 'iniciado', iniciado_em = now() WHERE id = $1`,
      [assessmentApplicationId],
    );

    await this.emitir(client, atual.rows[0].tenant_id, assessmentApplicationId, 'assessment.started', {
      assessment_application_id: assessmentApplicationId,
    });
  }

  async responderBloco(
    client: PoolClient,
    encryption: EnvelopeEncryptionService,
    input: ResponderBlocoInput,
  ): Promise<{ id: string }> {
    // Valida a coerência da escolha ANTES de gravar -- decomporBlocoEmPares
    // rejeita mais == menos e escolha fora do bloco. Bloco incoerente é
    // rejeitado na escrita, nunca normalizado em silêncio.
    decomporBlocoEmPares({
      blockId: input.blockId,
      itemIds: input.itemIds,
      maisId: input.maisId,
      menosId: input.menosId,
    });

    const payload = JSON.stringify({
      itemIds: input.itemIds,
      maisId: input.maisId,
      menosId: input.menosId,
    });
    const cifrado = encryption.encrypt(payload);

    const result = await client.query<{ id: string }>(
      `INSERT INTO item_response (assessment_application_id, block_id, resposta_criptografada, duracao_ms)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.assessmentApplicationId, input.blockId, JSON.stringify(cifrado), input.duracaoMs ?? null],
    );
    return { id: result.rows[0].id };
  }

  async concluir(
    client: PoolClient,
    encryption: EnvelopeEncryptionService,
    assessmentApplicationId: string,
  ): Promise<ResultadoEscoragem> {
    const cabecalho = await client.query<{
      tenant_id: string;
      person_id: string;
      instrument_version_id: string;
      status: string;
    }>(
      `SELECT tenant_id, person_id, instrument_version_id, status
         FROM assessment_application WHERE id = $1`,
      [assessmentApplicationId],
    );
    if (cabecalho.rows.length === 0) {
      throw new Error(`Assessment ${assessmentApplicationId} não encontrado`);
    }
    if (cabecalho.rows[0].status !== 'iniciado') {
      throw new Error(
        `Assessment ${assessmentApplicationId} não pode ser concluído (status atual: ${cabecalho.rows[0].status})`,
      );
    }
    const { tenant_id: tenantId, person_id: personId, instrument_version_id: versionId } = cabecalho.rows[0];

    // Catálogo de itens do instrumento, com os parâmetros vigentes.
    const catalogo = await client.query<{
      item_id: string;
      dominio: string;
      chave_valencia: 'positivo' | 'negativo';
      a: string;
      b: string;
      c: string;
    }>(
      `SELECT i.id AS item_id, i.dominio, i.chave_valencia, ipv.a, ipv.b, ipv.c
         FROM block b
         JOIN block_item bi ON bi.block_id = b.id
         JOIN item i ON i.id = bi.item_id
         JOIN item_parameter_version ipv ON ipv.item_id = i.id
        WHERE b.instrument_version_id = $1`,
      [versionId],
    );

    const itensPorId: Record<string, ItemNoBloco> = {};
    for (const linha of catalogo.rows) {
      itensPorId[linha.item_id] = {
        itemId: linha.item_id,
        dominio: linha.dominio,
        valencia: linha.chave_valencia,
        params: { a: Number(linha.a), b: Number(linha.b), c: Number(linha.c) },
      };
    }

    // Descriptografa em memória; o payload em claro nunca é persistido.
    const respostas = await client.query<{ block_id: string; resposta_criptografada: string }>(
      `SELECT block_id, resposta_criptografada FROM item_response WHERE assessment_application_id = $1`,
      [assessmentApplicationId],
    );

    const comparacoes: ComparacaoPar[] = [];
    for (const linha of respostas.rows) {
      const cifrado =
        typeof linha.resposta_criptografada === 'string'
          ? JSON.parse(linha.resposta_criptografada)
          : linha.resposta_criptografada;
      const aberto = JSON.parse(encryption.decrypt(cifrado)) as {
        itemIds: string[];
        maisId: string;
        menosId: string;
      };
      comparacoes.push(
        ...decomporBlocoEmPares({
          blockId: linha.block_id,
          itemIds: aberto.itemIds,
          maisId: aberto.maisId,
          menosId: aberto.menosId,
        }),
      );
    }

    const theta: Record<string, number> = {};
    const seTheta: Record<string, number> = {};
    for (const dimensao of DIMENSOES) {
      const estimativa = estimarThetaEAP(comparacoes, dimensao, itensPorId);
      theta[dimensao] = estimativa.theta;
      seTheta[dimensao] = estimativa.se;
    }

    // Índice de confiança do protocolo: 1 - SE médio, limitado a [0,1].
    // Com parâmetros provisórios isto é indicativo, não garantia -- o
    // relatório (Task 12) marca isso explicitamente.
    const seMedio = DIMENSOES.reduce((acc, d) => acc + seTheta[d], 0) / DIMENSOES.length;
    const protocoloConfianca = Math.max(0, Math.min(1, 1 - seMedio));

    const resultado = await client.query<{ id: string }>(
      `INSERT INTO assessment_result
         (person_id, instrument_version_id, theta, se_theta, escore_bruto, protocolo_confianca, respondido_em, calibracao_versao)
       VALUES ($1,$2,$3,$4,$5,$6,now(),$7) RETURNING id`,
      [
        personId,
        versionId,
        JSON.stringify(theta),
        JSON.stringify(seTheta),
        JSON.stringify(theta),
        protocoloConfianca.toFixed(2),
        'literatura_v1',
      ],
    );

    await client.query(
      `UPDATE assessment_application SET status = 'concluido', concluido_em = now() WHERE id = $1`,
      [assessmentApplicationId],
    );

    await this.emitir(client, tenantId, assessmentApplicationId, 'assessment.completed', {
      assessment_application_id: assessmentApplicationId,
      assessment_result_id: resultado.rows[0].id,
      person_id: personId,
    });

    return { assessmentResultId: resultado.rows[0].id, theta, seTheta };
  }

  private async emitir(
    client: PoolClient,
    tenantId: string,
    aggregateId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sequence = await nextOutboxSequence(client, aggregateId);
    await this.outbox.write(client, {
      tenantId,
      aggregateType: 'assessment_application',
      aggregateId,
      eventType,
      sequence,
      payload,
      occurredAt: new Date(),
    });
  }
}

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { OutboxService } from '../outbox/outbox.service';
import { nextOutboxSequence } from '../outbox/next-outbox-sequence';
import { generateSeoSlug } from './seo-slug';
import { RequisitionService } from './requisition.service';
import { JobRecrutadorService, PAPEIS_COM_ACESSO_TOTAL } from './job-recrutador.service';
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
  contagemCandidaturas: number;
}

export interface JobDetail {
  id: string;
  titulo: string;
  descricao: string;
  habilidadesExigidas: string[];
  publicadoEm: Date | null;
  criadoEm: Date;
  instrumentVersionId: string | null;
}

export interface EditarJobInput {
  tenantId: string;
  jobId: string;
  titulo?: string;
  descricao?: string;
  habilidadesExigidas?: string[];
  // undefined = campo nao enviado, nao mexe; null = enviado vazio,
  // desvincula o instrumento; string = define o instrumento.
  instrumentVersionId?: string | null;
}

export interface CandidaturaResumo {
  id: string;
  personId: string;
  nomeCandidato: string;
  criadoEm: Date;
  assessmentStatus: 'convidado' | 'iniciado' | 'concluido' | null;
  origemCanal: string | null;
}

export interface FunilDaVaga {
  funil: Record<string, CandidaturaResumo[]>;
  conversao: Record<string, number | null>;
}

// A CHECK de assessment_application.status admite um quarto valor,
// 'expirado' (nenhum job de expiração escreve isso hoje -- é latente).
// funil-formatacao.ts (apps/web) indexa o rótulo do chip por essas 3
// chaves; um quarto status empurraria um chip com rótulo `undefined`, um
// pill cinza vazio no card. Normaliza na borda: qualquer status fora das
// 3 chaves conhecidas vira null (sem chip), não um valor que quebra a
// UI.
const ASSESSMENT_STATUS_CONHECIDOS = ['convidado', 'iniciado', 'concluido'] as const;

function normalizarAssessmentStatus(status: string | null): CandidaturaResumo['assessmentStatus'] {
  if (status === null) return null;
  return (ASSESSMENT_STATUS_CONHECIDOS as readonly string[]).includes(status)
    ? (status as CandidaturaResumo['assessmentStatus'])
    : null;
}

// Ordem canônica do pipeline. Mora na API, não no cliente: conversão é
// regra de negócio, e sem uma ordem definida "conversão da etapa N" não
// tem significado. Etapa que aparecer nos dados fora desta lista não
// recebe conversão -- o sistema não inventa a posição dela no funil.
export const ORDEM_ETAPAS = ['triagem', 'entrevista'] as const;

export interface DashboardMetricas {
  vagasAtivas: number;
  vagasRascunho: number;
  candidaturasEmAndamento: number;
  porEstagio: Record<string, number>;
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
    // Mesma lógica conservadora de JobRecrutadorService.exigirAcesso (Fase
    // 5a, fix I5): qualquer papel que NÃO esteja em PAPEIS_COM_ACESSO_TOTAL
    // (admin_tenant, gestor_vaga) é tratado como precisando de posse
    // (job_recrutador) para ver a vaga -- não apenas o papel "recrutador"
    // especificamente. Hoje só esses 3 papéis alcançam esta rota, então o
    // comportamento observável não muda; a diferença só aparece se um papel
    // novo (ex.: entrevistador) ganhar acesso de leitura no futuro sem
    // posse -- antes essa combinação veria TODAS as vagas do tenant (bug),
    // agora seria filtrada como um recrutador puro.
    const somenteRecrutador = !input.userRoles.some((papel) => PAPEIS_COM_ACESSO_TOTAL.includes(papel));

    const query = somenteRecrutador
      ? `SELECT j.id, j.titulo, j.publicado_em, j.criado_em,
           (SELECT COUNT(*) FROM application a WHERE a.job_id = j.id) AS contagem_candidaturas
         FROM job j
         JOIN job_recrutador jr ON jr.job_id = j.id AND jr.tenant_id = j.tenant_id
         WHERE j.tenant_id = $1 AND jr.staff_id = $2 ORDER BY j.criado_em DESC`
      : `SELECT id, titulo, publicado_em, criado_em,
           (SELECT COUNT(*) FROM application a WHERE a.job_id = job.id) AS contagem_candidaturas
         FROM job WHERE tenant_id = $1 ORDER BY criado_em DESC`;
    const params = somenteRecrutador ? [input.tenantId, input.userId] : [input.tenantId];

    const result = await client.query<{
      id: string;
      titulo: string;
      publicado_em: Date | null;
      criado_em: Date;
      contagem_candidaturas: string;
    }>(query, params);
    return result.rows.map((row) => ({
      id: row.id,
      titulo: row.titulo,
      publicadoEm: row.publicado_em,
      criadoEm: row.criado_em,
      contagemCandidaturas: Number(row.contagem_candidaturas),
    }));
  }

  async findById(client: PoolClient, input: { tenantId: string; jobId: string }): Promise<JobDetail | null> {
    const result = await client.query<{
      id: string;
      titulo: string;
      descricao: string;
      habilidades_exigidas: string[];
      publicado_em: Date | null;
      criado_em: Date;
      instrument_version_id: string | null;
    }>(
      `SELECT id, titulo, descricao, habilidades_exigidas, publicado_em, criado_em, instrument_version_id
       FROM job WHERE id = $1 AND tenant_id = $2`,
      [input.jobId, input.tenantId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      titulo: row.titulo,
      descricao: row.descricao,
      habilidadesExigidas: row.habilidades_exigidas,
      publicadoEm: row.publicado_em,
      criadoEm: row.criado_em,
      instrumentVersionId: row.instrument_version_id,
    };
  }

  async funil(client: PoolClient, input: { tenantId: string; jobId: string }): Promise<FunilDaVaga> {
    // LEFT JOIN LATERAL para o assessment: uma candidatura pode ter mais de
    // uma linha em assessment_application (reaplicação), e vale a mais
    // recente por convidado_em.
    const result = await client.query<{
      id: string;
      person_id: string;
      nome: string;
      etapa_funil: string;
      criado_em: Date;
      assessment_status: string | null;
      origem_canal: string | null;
    }>(
      `SELECT a.id, a.person_id, p.nome, a.etapa_funil, a.criado_em,
              aa.status AS assessment_status,
              ct.canal  AS origem_canal
       FROM application a
       JOIN person p ON p.id = a.person_id
       LEFT JOIN LATERAL (
         SELECT status FROM assessment_application
         WHERE tenant_id = a.tenant_id AND application_id = a.id
         ORDER BY convidado_em DESC
         LIMIT 1
       ) aa ON true
       LEFT JOIN candidate_touchpoint ct
         ON ct.tenant_id = a.tenant_id AND ct.id = a.touchpoint_id
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
        assessmentStatus: normalizarAssessmentStatus(row.assessment_status),
        origemCanal: row.origem_canal,
      });
    }

    const conversao = await this.conversaoPorEtapa(client, input);
    return { funil, conversao };
  }

  // "Alcançou a etapa" = está nela agora (etapa_funil atual) OU tem uma
  // transição com to_state nela OU tem uma transição com from_state nela.
  // O ramo do estado atual é necessário: candidaturas nascem em 'triagem'
  // sem gerar linha em pipeline_stage_transition, então contar só
  // transições daria zero para a primeira etapa e conversão nula para toda
  // a esteira.
  //
  // AdverseImpactSnapshotService.recompute (insights/adverse-impact-snapshot.service.ts)
  // responde a mesma pergunta ("quem alcançou a etapa X?") com uma
  // definição deliberadamente diferente (baseline literal 'triagem' UNION
  // to_state, sem from_state e sem olhar o estado atual) -- os dois
  // divergem em candidaturas que já saíram da primeira etapa mas não têm
  // transição para a etapa em questão. Ver o comentário lá para a
  // justificativa daquela definição; não convirja os dois aqui sem revisar
  // ambos os conjuntos de testes.
  private async conversaoPorEtapa(
    client: PoolClient,
    input: { tenantId: string; jobId: string },
  ): Promise<Record<string, number | null>> {
    // A transição registra from_state -> to_state: quem tem uma transição
    // com to_state = X alcançou X, mas quem tem from_state = X também
    // alcançou X (é de lá que ela partiu). Sem o ramo de from_state, uma
    // candidatura que já passou por uma etapa e seguiu adiante deixa de
    // contar como tendo alcançado essa etapa, subestimando o denominador.
    const result = await client.query<{ etapa: string; total: string }>(
      `SELECT etapa, count(DISTINCT application_id)::text AS total
       FROM (
         SELECT a.id AS application_id, a.etapa_funil AS etapa
         FROM application a
         WHERE a.tenant_id = $1 AND a.job_id = $2
         UNION
         SELECT t.application_id, t.to_state AS etapa
         FROM pipeline_stage_transition t
         JOIN application a2 ON a2.id = t.application_id
         WHERE t.tenant_id = $1 AND a2.job_id = $2
         UNION
         SELECT t.application_id, t.from_state AS etapa
         FROM pipeline_stage_transition t
         JOIN application a2 ON a2.id = t.application_id
         WHERE t.tenant_id = $1 AND a2.job_id = $2 AND t.from_state IS NOT NULL
       ) alcances
       GROUP BY etapa`,
      [input.tenantId, input.jobId],
    );

    const alcancaram: Record<string, number> = {};
    for (const row of result.rows) alcancaram[row.etapa] = Number(row.total);

    const conversao: Record<string, number | null> = {};
    ORDEM_ETAPAS.forEach((etapa, indice) => {
      if (indice === 0) {
        conversao[etapa] = null;
        return;
      }
      const denominador = alcancaram[ORDEM_ETAPAS[indice - 1]] ?? 0;
      conversao[etapa] = denominador === 0 ? null : Math.round((100 * (alcancaram[etapa] ?? 0)) / denominador);
    });
    return conversao;
  }

  async obterMetricas(client: PoolClient, input: ListarJobsInput): Promise<DashboardMetricas> {
    // Mesma lógica de posse de `listar` (Fase 5a, fix I5): qualquer papel
    // fora de PAPEIS_COM_ACESSO_TOTAL é tratado como recrutador puro.
    const somenteRecrutador = !input.userRoles.some((papel) => PAPEIS_COM_ACESSO_TOTAL.includes(papel));

    const vagasQuery = somenteRecrutador
      ? `SELECT
           COUNT(*) FILTER (WHERE j.publicado_em IS NOT NULL) AS vagas_ativas,
           COUNT(*) FILTER (WHERE j.publicado_em IS NULL) AS vagas_rascunho
         FROM job j
         JOIN job_recrutador jr ON jr.job_id = j.id AND jr.tenant_id = j.tenant_id
         WHERE j.tenant_id = $1 AND jr.staff_id = $2`
      : `SELECT
           COUNT(*) FILTER (WHERE publicado_em IS NOT NULL) AS vagas_ativas,
           COUNT(*) FILTER (WHERE publicado_em IS NULL) AS vagas_rascunho
         FROM job WHERE tenant_id = $1`;
    const vagasParams = somenteRecrutador ? [input.tenantId, input.userId] : [input.tenantId];
    const vagasResult = await client.query<{ vagas_ativas: string; vagas_rascunho: string }>(vagasQuery, vagasParams);

    const estagioQuery = somenteRecrutador
      ? `SELECT a.etapa_funil, COUNT(*) AS total
         FROM application a
         JOIN job_recrutador jr ON jr.job_id = a.job_id AND jr.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1 AND jr.staff_id = $2
         GROUP BY a.etapa_funil`
      : `SELECT etapa_funil, COUNT(*) AS total FROM application WHERE tenant_id = $1 GROUP BY etapa_funil`;
    const estagioParams = somenteRecrutador ? [input.tenantId, input.userId] : [input.tenantId];
    const estagioResult = await client.query<{ etapa_funil: string; total: string }>(estagioQuery, estagioParams);

    const porEstagio: Record<string, number> = {};
    let candidaturasEmAndamento = 0;
    for (const row of estagioResult.rows) {
      const total = Number(row.total);
      porEstagio[row.etapa_funil] = total;
      candidaturasEmAndamento += total;
    }

    return {
      vagasAtivas: Number(vagasResult.rows[0].vagas_ativas),
      vagasRascunho: Number(vagasResult.rows[0].vagas_rascunho),
      candidaturasEmAndamento,
      porEstagio,
    };
  }

  async editar(client: PoolClient, input: EditarJobInput): Promise<void> {
    // instrument_version_id não pode usar COALESCE como os demais campos:
    // o frontend precisa poder ENVIAR null para desvincular o instrumento
    // (usuário seleciona "Nenhum" no seletor), mas COALESCE(null, coluna)
    // manteria o valor antigo -- indistinguível de "campo não enviado".
    // O CASE abaixo usa $6 (booleano "instrumentVersionId foi enviado no
    // input?") para decidir: só mexe na coluna quando o campo foi de fato
    // enviado, e nesse caso usa exatamente o que veio em $7 (inclusive
    // null, que desvincula).
    const instrumentVersionIdEnviado = input.instrumentVersionId !== undefined;
    await client.query(
      `UPDATE job SET
         titulo = COALESCE($3, titulo),
         descricao = COALESCE($4, descricao),
         habilidades_exigidas = COALESCE($5, habilidades_exigidas),
         instrument_version_id = CASE WHEN $6::boolean THEN $7::uuid ELSE instrument_version_id END
       WHERE id = $1 AND tenant_id = $2`,
      [
        input.jobId,
        input.tenantId,
        input.titulo ?? null,
        input.descricao ?? null,
        input.habilidadesExigidas ?? null,
        instrumentVersionIdEnviado,
        input.instrumentVersionId ?? null,
      ],
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

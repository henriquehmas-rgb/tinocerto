import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { calcularRazoes4Quintos, ContagemCategoria } from './adverse-impact-calculation';

interface DimensaoConfig {
  nome: string;
  categoriaExpr: string;
}

// Só quatro dimensões fixas nesta fase -- expressões SQL literais, nunca
// interpoladas a partir de entrada externa (sem risco de injeção: o array
// é constante do código, não vem de request nenhum).
const DIMENSOES: DimensaoConfig[] = [
  { nome: 'genero', categoriaExpr: 'dsr.genero' },
  { nome: 'raca_cor', categoriaExpr: 'dsr.raca_cor' },
  { nome: 'faixa_etaria', categoriaExpr: 'dsr.faixa_etaria' },
  { nome: 'pcd', categoriaExpr: `CASE WHEN dsr.pcd THEN 'sim' WHEN dsr.pcd = false THEN 'nao' ELSE NULL END` },
];

export interface SnapshotRow {
  etapa: string;
  grupoDemografico: string;
  taxaSelecao: number;
  razao4Quintos: number;
  calculadoEm: Date;
}

@Injectable()
export class AdverseImpactSnapshotService {
  /**
   * Recalcula TODAS as linhas de adverse_impact_snapshot de uma vaga, para
   * as quatro dimensões. "etapa" = 'triagem' (todo mundo que se
   * candidatou, baseline implícito -- ApplicationService.create não grava
   * pipeline_stage_transition na criação) UNION os to_state reais de
   * pipeline_stage_transition UNION 'reprovado' sintético (a partir de
   * decision.tipo = 'reprovacao', que não necessariamente move
   * etapa_funil).
   */
  async recompute(client: PoolClient, tenantId: string, jobId: string): Promise<void> {
    for (const dimensao of DIMENSOES) {
      const { rows } = await client.query<{
        etapa: string;
        categoria: string;
        alcancaram: string;
        total_grupo: string;
      }>(
        `
        WITH alcancou AS (
          SELECT a.id AS application_id, 'triagem' AS etapa
          FROM application a
          WHERE a.tenant_id = $1 AND a.job_id = $2

          UNION

          SELECT pst.application_id, pst.to_state AS etapa
          FROM pipeline_stage_transition pst
          JOIN application a ON a.id = pst.application_id AND a.tenant_id = pst.tenant_id
          WHERE pst.tenant_id = $1 AND a.job_id = $2

          UNION

          SELECT d.application_id, 'reprovado' AS etapa
          FROM decision d
          JOIN application a ON a.id = d.application_id AND a.tenant_id = d.tenant_id
          WHERE d.tenant_id = $1 AND a.job_id = $2 AND d.tipo = 'reprovacao'
        ),
        totais AS (
          SELECT a.id AS application_id, ${dimensao.categoriaExpr} AS categoria
          FROM application a
          JOIN demographic_self_report dsr ON dsr.tenant_id = a.tenant_id AND dsr.person_id = a.person_id
          WHERE a.tenant_id = $1 AND a.job_id = $2
        )
        SELECT al.etapa, t.categoria, count(DISTINCT al.application_id) AS alcancaram,
               (SELECT count(*) FROM totais t2 WHERE t2.categoria = t.categoria) AS total_grupo
        FROM alcancou al
        JOIN totais t ON t.application_id = al.application_id
        WHERE t.categoria IS NOT NULL
        GROUP BY al.etapa, t.categoria
        `,
        [tenantId, jobId],
      );

      const porEtapa = new Map<string, ContagemCategoria[]>();
      for (const row of rows) {
        const lista = porEtapa.get(row.etapa) ?? [];
        lista.push({ categoria: row.categoria, alcancaram: Number(row.alcancaram), totalGrupo: Number(row.total_grupo) });
        porEtapa.set(row.etapa, lista);
      }

      for (const [etapa, categorias] of porEtapa) {
        const razoes = calcularRazoes4Quintos(categorias);
        for (const razao of razoes) {
          const grupo = `${dimensao.nome}:${razao.categoria}`;
          await client.query(
            `INSERT INTO adverse_impact_snapshot (tenant_id, job_id, etapa, grupo_demografico, taxa_selecao, razao_4_5, calculado_em)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (tenant_id, job_id, etapa, grupo_demografico) DO UPDATE
             SET taxa_selecao = $5, razao_4_5 = $6, calculado_em = now()`,
            [tenantId, jobId, etapa, grupo, razao.taxaSelecao, razao.razao4Quintos],
          );
        }
      }
    }
  }

  async listarPorVaga(client: PoolClient, jobId: string): Promise<SnapshotRow[]> {
    const { rows } = await client.query<{
      etapa: string;
      grupo_demografico: string;
      taxa_selecao: string;
      razao_4_5: string;
      calculado_em: Date;
    }>(
      `SELECT etapa, grupo_demografico, taxa_selecao, razao_4_5, calculado_em
       FROM adverse_impact_snapshot WHERE job_id = $1 ORDER BY etapa, grupo_demografico`,
      [jobId],
    );
    return rows.map((r) => ({
      etapa: r.etapa,
      grupoDemografico: r.grupo_demografico,
      taxaSelecao: Number(r.taxa_selecao),
      razao4Quintos: Number(r.razao_4_5),
      calculadoEm: r.calculado_em,
    }));
  }
}

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
  { nome: 'pcd', categoriaExpr: `CASE WHEN dsr.pcd THEN 'sim' WHEN NOT dsr.pcd THEN 'nao' END` },
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
   * pipeline_stage_transition.
   *
   * NÃO existe etapa sintética 'reprovado' (achado de re-revisão
   * adversarial): a regra dos 4/5 assume "taxa mais alta = referência
   * boa", e isso se inverte para uma medida de REPROVAÇÃO (taxa mais alta
   * = pior, não melhor). Calculado com a mesma fórmula, o grupo mais
   * reprovado vira a "referência" com razão 1.0, e um grupo com reprovação
   * BAIXA (bom resultado) pode aparecer com razão baixa -- sinal
   * ativamente invertido num painel antidiscriminação. Corrigir isso
   * exige tratamento próprio (medir sobrevivência, não reprovação
   * diretamente, ou inverter a comparação) -- decisão de design que não
   * existia quando esta task foi escrita. Até essa decisão ser tomada,
   * melhor não emitir o sinal do que emitir um sinal errado.
   */
  async recompute(client: PoolClient, tenantId: string, jobId: string): Promise<void> {
    // Achado Important de re-revisão adversarial: sem isto, duas chamadas
    // concorrentes de recompute() para a MESMA vaga (esperado a partir da
    // Task 5, consumidor de outbox reagindo a eventos em rajada) podem se
    // intercalar sob READ COMMITTED de um jeito que o DELETE de uma
    // chamada nunca vê o que a outra ainda não commitou -- reintroduzindo
    // sob concorrência o mesmo bug de linha obsoleta que este arquivo
    // acabou de fechar. Lock consultivo de transação serializa
    // recompute() por vaga (chave = tenant+job, não só job, para não
    // colidir por acidente entre tenants diferentes); libera sozinho no
    // COMMIT/ROLLBACK da transação de TenantContext.run.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenantId}:${jobId}`]);

    for (const dimensao of DIMENSOES) {
      // Achado CRITICAL de revisão adversarial: a versão anterior desta
      // query derivava a grade (etapa, categoria) das linhas que
      // SOBRAVAM do JOIN entre "quem alcançou" e "quem está no grupo" --
      // uma categoria cujas candidaturas TODAS falharam em alcançar uma
      // etapa contribuía zero linhas ao JOIN, então nunca aparecia no
      // GROUP BY, e a linha inteira (com taxa=0, razão=0 -- o pior caso
      // de impacto adverso possível) simplesmente sumia do painel em vez
      // de aparecer como o sinal mais grave. Corrigido: materializa a
      // grade etapa × categoria via CROSS JOIN primeiro (`grade`), depois
      // faz LEFT JOIN de quem alcançou -- uma categoria com zero
      // candidaturas alcançando aquela etapa produz `alcancaram = 0` de
      // verdade, não ausência de linha.
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
        ),
        totais AS (
          SELECT a.id AS application_id, ${dimensao.categoriaExpr} AS categoria
          FROM application a
          JOIN demographic_self_report dsr ON dsr.tenant_id = a.tenant_id AND dsr.person_id = a.person_id
          WHERE a.tenant_id = $1 AND a.job_id = $2
        ),
        categorias AS (
          SELECT DISTINCT categoria FROM totais WHERE categoria IS NOT NULL
        ),
        etapas AS (
          SELECT DISTINCT etapa FROM alcancou
        ),
        grade AS (
          SELECT e.etapa, c.categoria FROM etapas e CROSS JOIN categorias c
        )
        SELECT g.etapa, g.categoria,
               count(DISTINCT al.application_id) AS alcancaram,
               (SELECT count(*) FROM totais t2 WHERE t2.categoria = g.categoria) AS total_grupo
        FROM grade g
        LEFT JOIN totais t ON t.categoria = g.categoria
        LEFT JOIN alcancou al ON al.application_id = t.application_id AND al.etapa = g.etapa
        GROUP BY g.etapa, g.categoria
        `,
        [tenantId, jobId],
      );

      const porEtapa = new Map<string, ContagemCategoria[]>();
      for (const row of rows) {
        const lista = porEtapa.get(row.etapa) ?? [];
        lista.push({ categoria: row.categoria, alcancaram: Number(row.alcancaram), totalGrupo: Number(row.total_grupo) });
        porEtapa.set(row.etapa, lista);
      }

      // Achado Important de revisão adversarial: sem este DELETE, uma
      // linha que deixou de ser produzida nesta rodada (grupo caiu abaixo
      // do limiar mínimo, candidato revogou a autodeclaração) permanecia
      // no snapshot indefinidamente com o valor calculado sobre dado que
      // já não existe. Apagar-e-reinserir por dimensão, dentro da mesma
      // transação de TenantContext.run, é atômico -- nenhum leitor vê
      // painel vazio no meio do caminho.
      await client.query(
        `DELETE FROM adverse_impact_snapshot WHERE tenant_id = $1 AND job_id = $2 AND grupo_demografico LIKE $3`,
        [tenantId, jobId, `${dimensao.nome}:%`],
      );

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

import { Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { classificarTermosClinicos } from './clinical-vocabulary-linter';

export const RODAPE_OBRIGATORIO =
  'Este relatório descreve preferências de comportamento no trabalho e não constitui avaliação psicológica.';

export interface SecaoRelatorio {
  dimensao: string;
  titulo: string;
  texto: string;
  escoreBruto: number;
  erroPadrao: number;
}

export interface RelatorioTrilhoA {
  assessmentResultId: string;
  secoes: SecaoRelatorio[];
  indiceConfiancaProtocolo: number | null;
  calibracaoProvisoria: boolean;
  avisoCalibracao: string | null;
  rodape: string;
}

/**
 * Rótulos comportamentais -- nenhum termo clínico, por construção.
 *
 * Exportado de propósito: a faixa (alto/medio/baixo) escolhida para cada
 * theta é a ÚNICA lógica substantiva deste serviço, e um teste que não
 * amarra "theta X produz exatamente este rótulo" não detecta uma inversão
 * de sinal no corte -- descreveria quem pontuou alto com o texto de quem
 * pontuou baixo e publicaria assim. O teste compara contra estas
 * constantes em vez de recolar os textos.
 */
export const ROTULOS: Record<string, { titulo: string; alto: string; medio: string; baixo: string }> = {
  conscienciosidade: {
    titulo: 'Organização e cumprimento de prazos',
    alto: 'Tende a planejar com antecedência, revisar entregas e sustentar prazos sem cobrança externa.',
    medio: 'Equilibra planejamento e flexibilidade, ajustando o método conforme a demanda.',
    baixo: 'Tende a priorizar o que surge no momento, com menos apego a planejamento formal.',
  },
  extroversao: {
    titulo: 'Interação e presença em grupo',
    alto: 'Busca contato com pessoas novas e costuma assumir a condução em discussões de grupo.',
    medio: 'Alterna entre participar ativamente e observar, conforme o contexto da conversa.',
    baixo: 'Prefere trabalho individual e tende a se manter reservado em grupos grandes.',
  },
  amabilidade: {
    titulo: 'Cooperação e leitura do outro',
    alto: 'Costuma priorizar a relação, dividir crédito e considerar o ponto de vista alheio antes de discordar.',
    medio: 'Equilibra cooperação e defesa da própria posição conforme o que está em jogo.',
    baixo: 'Tende a ser direto e sustentar a própria posição mesmo com desgaste na relação.',
  },
  estabilidade: {
    titulo: 'Reação a pressão de trabalho',
    alto: 'Mantém o ritmo e a qualidade de decisão quando o prazo aperta ou as prioridades mudam.',
    medio: 'Responde bem à pressão na maior parte do tempo, com variação conforme o acúmulo de demandas.',
    baixo: 'Sente mais o impacto de mudanças de prioridade e leva mais tempo para retomar o ritmo.',
  },
  abertura: {
    titulo: 'Abertura a novos métodos',
    alto: 'Propõe alternativas, questiona processos consolidados e busca aprender ferramentas novas.',
    medio: 'Aceita métodos novos quando há motivo claro, mantendo o que já funciona.',
    baixo: 'Prefere o método conhecido e tende a manter o processo estabelecido.',
  },
};

@Injectable()
export class ReportService {
  /**
   * Gera o relatório trilho A de um `assessment_result`.
   *
   * PRÉ-CONDIÇÃO DE AUTORIZAÇÃO: `db` precisa estar dentro de um
   * `TenantContext.run()` -- é de lá que sai o `app.tenant_id` consultado
   * abaixo. `assessment_result` é GLOBAL (sem `tenant_id`, sem RLS): é o
   * ativo reaproveitável entre tenants. Quem autoriza a leitura é
   * `result_grant`, a ponte de consentimento. Sem o JOIN explícito, um
   * `SELECT ... WHERE id = $1` devolveria o relatório comportamental de
   * QUALQUER candidato para QUALQUER recrutador que soubesse o UUID --
   * IDOR cross-tenant no payload mais sensível da fase. A RLS de
   * `result_grant` sozinha não fecha isso: ela filtra a ponte, não o
   * resultado, e nem sequer se aplica a uma conexão que não seja
   * `app_runtime`. Por isso o predicado de tenant aparece ESCRITO na query
   * (defesa em profundidade), no formato `NULLIF(...)` obrigatório da
   * Fase 0 -- que, com a GUC ausente, resolve para NULL e derruba o
   * `EXISTS`, isto é, falha FECHADO.
   */
  async gerar(db: Pool | PoolClient, assessmentResultId: string): Promise<RelatorioTrilhoA> {
    const { rows } = await db.query<{
      id: string;
      theta: Record<string, number> | null;
      se_theta: Record<string, number> | null;
      protocolo_confianca: string | null;
      calibracao_versao: string | null;
    }>(
      `SELECT r.id, r.theta, r.se_theta, r.protocolo_confianca, r.calibracao_versao
         FROM assessment_result r
        WHERE r.id = $1
          AND EXISTS (
            SELECT 1
              FROM result_grant g
             WHERE g.assessment_result_id = r.id
               AND g.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
               AND g.revoked_at IS NULL
               AND (g.expires_at IS NULL OR g.expires_at > now())
          )`,
      [assessmentResultId],
    );
    if (rows.length === 0) {
      // Mesma resposta para "não existe" e "existe mas este tenant não tem
      // grant vivo", de propósito: distinguir os dois casos transformaria o
      // endpoint num oráculo de existência de resultado alheio. E não ecoa
      // o UUID recebido de volta no corpo da resposta.
      throw new NotFoundException('Relatório não encontrado para este assessment_result');
    }
    const resultado = rows[0];

    if (resultado.theta === null || Object.keys(resultado.theta).length === 0) {
      throw new Error(
        'assessment_result ainda não foi escorado (theta ausente) -- não há o que relatar',
      );
    }

    const secoes: SecaoRelatorio[] = Object.entries(resultado.theta).map(([dimensao, valor]) => {
      const rotulo = ROTULOS[dimensao];
      if (!rotulo) {
        throw new Error(`Dimensão ${dimensao} não tem rótulo de relatório definido`);
      }
      // Um theta sem o SE correspondente não é medida: publicar o prior
      // (SE = 1) no lugar entregaria "parece medida e não é" -- o mesmo
      // risco que mfc-scoring.ts já documenta. Falha em vez de fabricar.
      const erroPadrao = resultado.se_theta?.[dimensao];
      if (erroPadrao === undefined || erroPadrao === null) {
        throw new Error(
          `Dimensão ${dimensao} tem theta mas não tem erro padrão gravado em se_theta -- resultado inconsistente, relatório não pode ser publicado`,
        );
      }
      const texto = valor > 0.5 ? rotulo.alto : valor < -0.5 ? rotulo.baixo : rotulo.medio;
      return {
        dimensao,
        titulo: rotulo.titulo,
        texto,
        escoreBruto: Number(valor.toFixed(3)),
        erroPadrao: Number(erroPadrao.toFixed(3)),
      };
    });

    // Uma calibração ainda não real significa escore ainda provisório --
    // dizer isso é obrigação, não cortesia.
    const calibracaoProvisoria = (resultado.calibracao_versao ?? '').startsWith('literatura');

    const relatorio: RelatorioTrilhoA = {
      assessmentResultId: resultado.id,
      secoes,
      // NULL é "confiança de protocolo nunca calculada", não "confiança
      // 0.00". Coalescer para 0 publicaria o PIOR valor possível para um
      // protocolo que simplesmente não foi avaliado.
      indiceConfiancaProtocolo:
        resultado.protocolo_confianca === null ? null : Number(resultado.protocolo_confianca),
      calibracaoProvisoria,
      avisoCalibracao: calibracaoProvisoria
        ? 'Os parâmetros deste instrumento ainda são provisórios (derivados de literatura, não de calibração sobre respostas coletadas). Use os escores como ordenação relativa dentro da vaga, não como medida absoluta.'
        : null,
      rodape: RODAPE_OBRIGATORIO,
    };

    // Gate final: o corpo gerado NÃO pode conter vocabulário clínico. Se
    // contiver, é bug de rótulo -- lança em vez de publicar. O rodapé é
    // verificado à parte porque contém "avaliação psicológica" NEGADA, por
    // exigência legal.
    const corpo = secoes.map((s) => `${s.titulo} ${s.texto}`).join(' ');
    const termos = classificarTermosClinicos(corpo);
    if (termos.length > 0) {
      throw new Error(
        `Relatório do resultado ${assessmentResultId} contém vocabulário clínico (${termos.join(', ')}) e não pode ser publicado`,
      );
    }

    return relatorio;
  }
}

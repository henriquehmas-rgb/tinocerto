import { Injectable } from '@nestjs/common';
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
  indiceConfiancaProtocolo: number;
  calibracaoProvisoria: boolean;
  avisoCalibracao: string | null;
  rodape: string;
}

/** Rótulos comportamentais -- nenhum termo clínico, por construção. */
const ROTULOS: Record<string, { titulo: string; alto: string; medio: string; baixo: string }> = {
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
  async gerar(db: Pool | PoolClient, assessmentResultId: string): Promise<RelatorioTrilhoA> {
    const { rows } = await db.query<{
      id: string;
      theta: Record<string, number>;
      se_theta: Record<string, number>;
      protocolo_confianca: string | null;
      calibracao_versao: string | null;
    }>(
      `SELECT id, theta, se_theta, protocolo_confianca, calibracao_versao
         FROM assessment_result WHERE id = $1`,
      [assessmentResultId],
    );
    if (rows.length === 0) {
      throw new Error(`assessment_result ${assessmentResultId} não encontrado`);
    }
    const resultado = rows[0];

    const secoes: SecaoRelatorio[] = Object.entries(resultado.theta).map(([dimensao, valor]) => {
      const rotulo = ROTULOS[dimensao];
      if (!rotulo) {
        throw new Error(`Dimensão ${dimensao} não tem rótulo de relatório definido`);
      }
      const texto = valor > 0.5 ? rotulo.alto : valor < -0.5 ? rotulo.baixo : rotulo.medio;
      return {
        dimensao,
        titulo: rotulo.titulo,
        texto,
        escoreBruto: Number(valor.toFixed(3)),
        erroPadrao: Number((resultado.se_theta[dimensao] ?? 1).toFixed(3)),
      };
    });

    // Uma calibração ainda não real significa escore ainda provisório --
    // dizer isso é obrigação, não cortesia.
    const calibracaoProvisoria = (resultado.calibracao_versao ?? '').startsWith('literatura');

    const relatorio: RelatorioTrilhoA = {
      assessmentResultId: resultado.id,
      secoes,
      indiceConfiancaProtocolo: Number(resultado.protocolo_confianca ?? 0),
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

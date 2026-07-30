import { ItemParams } from './irt-primitives';

export interface ItemNoBloco {
  itemId: string;
  dominio: string;
  valencia: 'positivo' | 'negativo';
  params: ItemParams;
}

export interface RespostaBloco {
  blockId: string;
  itemIds: string[];
  /** Item apontado como MAIS característico. */
  maisId: string;
  /** Item apontado como MENOS característico. */
  menosId: string;
}

export interface ComparacaoPar {
  blockId: string;
  vencedorId: string;
  perdedorId: string;
}

/**
 * Decompõe a resposta de um bloco MFC em comparações par-a-par binárias --
 * a decomposição Thurstoniana padrão. É o que permite escorar de forma
 * NORMATIVA (θ comparável entre pessoas) em vez de produzir ranking
 * ipsativo cru, que só diz a ordem interna de cada respondente.
 *
 * Regras derivadas de "mais" e "menos":
 *   - o item MAIS característico vence todos os outros do bloco;
 *   - o item MENOS característico perde para todos os outros;
 *   - o par (mais, menos) é gerado uma vez só, não duas.
 */
export function decomporBlocoEmPares(resposta: RespostaBloco): ComparacaoPar[] {
  const { blockId, itemIds, maisId, menosId } = resposta;

  if (maisId === menosId) {
    throw new Error(
      `Bloco ${blockId}: mais e menos característico não podem ser o mesmo item (${maisId})`,
    );
  }
  for (const escolhido of [maisId, menosId]) {
    if (!itemIds.includes(escolhido)) {
      throw new Error(`Bloco ${blockId}: item ${escolhido} não pertence ao bloco`);
    }
  }

  const pares: ComparacaoPar[] = [];

  for (const outro of itemIds) {
    if (outro !== maisId) {
      pares.push({ blockId, vencedorId: maisId, perdedorId: outro });
    }
  }
  for (const outro of itemIds) {
    // O par (mais, menos) já foi criado acima -- não duplicar.
    if (outro !== menosId && outro !== maisId) {
      pares.push({ blockId, vencedorId: outro, perdedorId: menosId });
    }
  }

  return pares;
}

/**
 * Discriminação efetiva do item na dimensão que ele mede.
 *
 * Um item de chave NEGATIVA mede o traço ao contrário: quanto MAIOR o θ,
 * MENOS provável que o respondente o aponte como característico. Inverter o
 * sinal de `a` é exatamente o que representa isso -- e é o que faz o
 * chaveamento oposto dentro do bloco quebrar a ipsatividade.
 */
function aEfetivo(item: ItemNoBloco): number {
  return item.valencia === 'positivo' ? item.params.a : -item.params.a;
}

/** Grade de quadratura: θ de -4 a 4, passo 0,1 (81 pontos). */
const GRADE_MIN = -4;
const GRADE_MAX = 4;
const GRADE_PASSO = 0.1;

function gradeTheta(): number[] {
  const pontos: number[] = [];
  for (let t = GRADE_MIN; t <= GRADE_MAX + 1e-9; t += GRADE_PASSO) {
    pontos.push(Number(t.toFixed(4)));
  }
  return pontos;
}

/** Densidade do prior N(0,1) -- constante omitida (normaliza no fim). */
function prior(theta: number): number {
  return Math.exp(-0.5 * theta * theta);
}

/**
 * Estima θ de UMA dimensão por EAP (Expected A Posteriori) sobre grade.
 *
 * APROXIMAÇÃO DELIBERADA DESTA FASE: o TIRT completo estima todas as
 * dimensões conjuntamente; grade em 5-D seria ~4M pontos. Aqui cada dimensão
 * é estimada em grade 1-D própria, tratando as demais como fixas na média do
 * prior (θ = 0). Isso ignora a covariância entre dimensões na estimação.
 * É aproximação, NÃO TIRT completo -- documentado na spec e marcado no
 * relatório. Trocar por estimação conjunta depois substitui só este
 * estimador, sem tocar em schema nem em dado já gravado.
 *
 * EAP e não MLE porque MLE diverge em padrão de resposta extremo (o
 * respondente que escolhe sempre o mesmo polo): a verossimilhança não tem
 * máximo finito. O prior do EAP regulariza e sempre converge.
 */
export function estimarThetaEAP(
  comparacoes: ComparacaoPar[],
  dimensao: string,
  itensPorId: Record<string, ItemNoBloco>,
): { theta: number; se: number } {
  // Só as comparações em que ao menos um lado mede a dimensão pedida.
  const relevantes = comparacoes.filter((par) => {
    const v = itensPorId[par.vencedorId];
    const p = itensPorId[par.perdedorId];
    return v?.dominio === dimensao || p?.dominio === dimensao;
  });

  const grade = gradeTheta();

  const pesos = grade.map((theta) => {
    let logVerossimilhanca = 0;

    for (const par of relevantes) {
      const vencedor = itensPorId[par.vencedorId];
      const perdedor = itensPorId[par.perdedorId];
      if (!vencedor || !perdedor) continue;

      // Utilidade de cada lado. O lado que NÃO mede esta dimensão entra com
      // θ = 0 (média do prior) -- é justamente a aproximação 1-D.
      const thetaVencedor = vencedor.dominio === dimensao ? theta : 0;
      const thetaPerdedor = perdedor.dominio === dimensao ? theta : 0;

      const uVencedor = aEfetivo(vencedor) * (thetaVencedor - vencedor.params.b);
      const uPerdedor = aEfetivo(perdedor) * (thetaPerdedor - perdedor.params.b);

      // Bradley-Terry-Luce com parametrização TRI: a chance de o vencedor
      // ter sido escolhido é logística na diferença de utilidades.
      const pEscolha = 1 / (1 + Math.exp(-(uVencedor - uPerdedor)));

      // Piso numérico: log(0) seria -Infinity e contaminaria a grade toda.
      logVerossimilhanca += Math.log(Math.max(pEscolha, 1e-12));
    }

    return Math.exp(logVerossimilhanca) * prior(theta);
  });

  const somaPesos = pesos.reduce((acc, w) => acc + w, 0);

  // Sem evidência nenhuma nesta dimensão (ou underflow total): devolve o
  // prior. É o resultado honesto -- não sabemos nada, então θ = 0 com a
  // incerteza cheia do prior, em vez de fingir precisão.
  if (!Number.isFinite(somaPesos) || somaPesos <= 0) {
    return { theta: 0, se: 1 };
  }

  const theta = grade.reduce((acc, t, i) => acc + t * pesos[i], 0) / somaPesos;
  const variancia = grade.reduce((acc, t, i) => acc + (t - theta) ** 2 * pesos[i], 0) / somaPesos;

  return { theta, se: Math.sqrt(Math.max(variancia, 0)) };
}

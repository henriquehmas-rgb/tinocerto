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
 *
 * ATENÇÃO -- esta função é PURA e só conhece o que recebe. Ela NÃO sabe
 * quais itens o bloco realmente tem no banco, e portanto NÃO é, sozinha,
 * validação de integridade da resposta: `itemIds` mentiroso entra e sai
 * como comparação válida. Quem grava resposta tem de conferir `itemIds`
 * contra `block_item` ANTES de chamar aqui (ver AssessmentService.responderBloco).
 */
export function decomporBlocoEmPares(resposta: RespostaBloco): ComparacaoPar[] {
  const { blockId, itemIds, maisId, menosId } = resposta;

  if (maisId === menosId) {
    throw new Error(
      `Bloco ${blockId}: mais e menos característico não podem ser o mesmo item (${maisId})`,
    );
  }
  const repetidos = new Set(itemIds);
  if (repetidos.size !== itemIds.length) {
    throw new Error(`Bloco ${blockId}: itemIds contém item repetido`);
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

/**
 * Comparações que de fato ENTRAM na verossimilhança de uma dimensão.
 *
 * Duas condições, e as duas importam:
 *   - os dois lados do par precisam existir no catálogo (item fora do
 *     instrumento não tem parâmetro e não pode contribuir);
 *   - ao menos um dos lados precisa medir a dimensão pedida.
 *
 * Existe como função exportada, e não como filtro embutido no estimador,
 * porque quem escora precisa CONTAR evidência antes de confiar no número:
 * uma dimensão com zero comparação relevante devolve exatamente o prior
 * (θ ≈ 0, SE ≈ 1) -- um valor que parece medida e não é. O contador e o
 * estimador têm de enxergar o mesmo conjunto, senão o contador mente.
 */
export function comparacoesRelevantes(
  comparacoes: ComparacaoPar[],
  dimensao: string,
  itensPorId: Record<string, ItemNoBloco>,
): ComparacaoPar[] {
  return comparacoes.filter((par) => {
    const vencedor = itensPorId[par.vencedorId];
    const perdedor = itensPorId[par.perdedorId];
    if (!vencedor || !perdedor) return false;
    return vencedor.dominio === dimensao || perdedor.dominio === dimensao;
  });
}

/**
 * Escore BRUTO observado da dimensão -- contagem de endosso chaveada.
 *
 * Não usa parâmetro nenhum: é a contagem crua de quantas vezes o
 * respondente empurrou a dimensão para o polo alto (item de chave positiva
 * escolhido como MAIS, ou item de chave negativa escolhido como MENOS)
 * menos quantas vezes empurrou para o polo baixo. Serve justamente para
 * ser INDEPENDENTE de θ: numa calibração ou numa auditoria é contra este
 * número que o θ estimado é comparado. Gravar θ duas vezes (uma como
 * `theta` e outra como `escore_bruto`) destruiria essa checagem.
 */
export function escoreBrutoPorDimensao(
  comparacoes: ComparacaoPar[],
  dimensao: string,
  itensPorId: Record<string, ItemNoBloco>,
): number {
  let escore = 0;
  for (const par of comparacoesRelevantes(comparacoes, dimensao, itensPorId)) {
    const vencedor = itensPorId[par.vencedorId];
    const perdedor = itensPorId[par.perdedorId];
    if (vencedor.dominio === dimensao) {
      escore += vencedor.valencia === 'positivo' ? 1 : -1;
    }
    if (perdedor.dominio === dimensao) {
      escore += perdedor.valencia === 'positivo' ? -1 : 1;
    }
  }
  return escore;
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

/**
 * LOG-densidade do prior N(0,1) -- constante omitida (normaliza no fim).
 *
 * Em log, e não na densidade direta, porque a grade inteira fica no espaço
 * logarítmico até a estabilização log-sum-exp de `estimarThetaEAP`.
 */
function logPrior(theta: number): number {
  return -0.5 * theta * theta;
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
 *
 * SEM EVIDÊNCIA ESTA FUNÇÃO NÃO AVISA: se `comparacoes` não tem nenhuma
 * comparação relevante para a dimensão, a verossimilhança fica plana, a
 * quadratura reconstrói o prior e o retorno é θ ≈ 0 / SE ≈ 1 -- que é a
 * resposta bayesiana correta, mas é INDISTINGUÍVEL de um respondente
 * genuinamente médio. Cabe a quem chama contar `comparacoesRelevantes`
 * antes e recusar escorar sem evidência (ver AssessmentService.concluir).
 */
export function estimarThetaEAP(
  comparacoes: ComparacaoPar[],
  dimensao: string,
  itensPorId: Record<string, ItemNoBloco>,
): { theta: number; se: number } {
  // Exatamente o conjunto que contribui -- mesmo critério do contador.
  const relevantes = comparacoesRelevantes(comparacoes, dimensao, itensPorId);

  const grade = gradeTheta();

  const logPesos = grade.map((theta) => {
    let logVerossimilhanca = 0;

    for (const par of relevantes) {
      const vencedor = itensPorId[par.vencedorId];
      const perdedor = itensPorId[par.perdedorId];

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

    // Continua em log até a estabilização abaixo -- nunca exponenciar aqui.
    return logVerossimilhanca + logPrior(theta);
  });

  /*
   * Estabilização log-sum-exp: subtrai o máximo da grade antes de
   * exponenciar. Sem ela, o peso de um instrumento longo é um produto de
   * muitas probabilidades < 1 e fura o menor subnormal representável em
   * TODOS os pontos da grade ao mesmo tempo (com p ~ 0,5 isso acontece por
   * volta de 1.075 comparações, e um respondente que responde contra o
   * modelo chega lá bem antes). A soma zerava, o atalho de "sem evidência"
   * disparava e a função devolvia { theta: 0, se: 1 } -- um escore que
   * PARECE legítimo (θ exatamente no centro, incerteza cheia do prior) no
   * lugar de um erro. Era a única falha silenciosa do estimador.
   *
   * Com a subtração do máximo, o ponto modal da grade pesa exatamente 1 e a
   * soma nunca pode zerar, qualquer que seja o comprimento do instrumento.
   * A constante subtraída cancela na normalização, então nem θ nem `se`
   * mudam de valor onde não havia underflow.
   */
  const maxLogPeso = logPesos.reduce((acc, lp) => (lp > acc ? lp : acc), -Infinity);
  const pesos = logPesos.map((lp) => Math.exp(lp - maxLogPeso));

  const somaPesos = pesos.reduce((acc, w) => acc + w, 0);

  // Grade inutilizável (parâmetro NaN/Infinity vindo do banco de itens):
  // devolve o prior. É o resultado honesto -- não sabemos nada, então θ = 0
  // com a incerteza cheia do prior, em vez de fingir precisão.
  if (!Number.isFinite(somaPesos) || somaPesos <= 0) {
    return { theta: 0, se: 1 };
  }

  const theta = grade.reduce((acc, t, i) => acc + t * pesos[i], 0) / somaPesos;
  const variancia = grade.reduce((acc, t, i) => acc + (t - theta) ** 2 * pesos[i], 0) / somaPesos;

  return { theta, se: Math.sqrt(Math.max(variancia, 0)) };
}

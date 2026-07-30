import { decomporBlocoEmPares, estimarThetaEAP, ItemNoBloco, ComparacaoPar } from '../mfc-scoring';

/**
 * PRNG determinístico (congruente linear). Semente fixa para o teste ser
 * reprodutível: um teste estatístico que falha esporadicamente por acaso é
 * pior que teste nenhum -- vira ruído que se aprende a ignorar.
 */
function criarRng(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado * 1664525 + 1013904223) >>> 0;
    return estado / 0x100000000;
  };
}

/** Monta um banco sintético de blocos com chaveamento oposto. */
function montarBanco(nBlocos: number): { itens: Record<string, ItemNoBloco>; blocos: string[][] } {
  const itens: Record<string, ItemNoBloco> = {};
  const blocos: string[][] = [];

  for (let b = 0; b < nBlocos; b++) {
    const idPos = `b${b}_pos`;
    const idNeg = `b${b}_neg`;

    // Dificuldades espalhadas pela escala para cobrir toda a faixa de θ.
    const dificuldade = -1.5 + (3 * b) / Math.max(nBlocos - 1, 1);

    itens[idPos] = {
      itemId: idPos,
      dominio: 'conscienciosidade',
      valencia: 'positivo',
      params: { a: 1.2, b: dificuldade, c: 0 },
    };
    itens[idNeg] = {
      itemId: idNeg,
      dominio: 'conscienciosidade',
      valencia: 'negativo',
      params: { a: 1.1, b: -dificuldade, c: 0 },
    };
    blocos.push([idPos, idNeg]);
  }

  return { itens, blocos };
}

/**
 * Simula um respondente de θ conhecido: para cada bloco, sorteia qual item
 * ele aponta como MAIS característico, com a probabilidade que o próprio
 * modelo prevê. É a geração de dados sob o modelo verdadeiro.
 */
function simularRespostas(
  thetaVerdadeiro: number,
  itens: Record<string, ItemNoBloco>,
  blocos: string[][],
  rng: () => number,
): ComparacaoPar[] {
  const comparacoes: ComparacaoPar[] = [];

  blocos.forEach((itemIds, indice) => {
    const [idA, idB] = itemIds;
    const a = itens[idA];
    const bItem = itens[idB];

    const aEfA = a.valencia === 'positivo' ? a.params.a : -a.params.a;
    const aEfB = bItem.valencia === 'positivo' ? bItem.params.a : -bItem.params.a;

    const uA = aEfA * (thetaVerdadeiro - a.params.b);
    const uB = aEfB * (thetaVerdadeiro - bItem.params.b);
    const pEscolheA = 1 / (1 + Math.exp(-(uA - uB)));

    const escolheA = rng() < pEscolheA;
    comparacoes.push(
      ...decomporBlocoEmPares({
        blockId: `b${indice}`,
        itemIds,
        maisId: escolheA ? idA : idB,
        menosId: escolheA ? idB : idA,
      }),
    );
  });

  return comparacoes;
}

describe('recuperação de parâmetro — o estimador devolve o theta que gerou os dados', () => {
  const { itens, blocos } = montarBanco(40);

  it.each([-1.5, -0.75, 0, 0.75, 1.5])(
    'recupera theta verdadeiro = %p dentro da margem esperada',
    (thetaVerdadeiro) => {
      const rng = criarRng(20260730 + Math.round(thetaVerdadeiro * 100));

      // Média de várias replicações: uma única aplicação de 40 blocos tem
      // erro amostral real: é o SE do próprio instrumento, não bug.
      const estimativas: number[] = [];
      for (let r = 0; r < 30; r++) {
        const comparacoes = simularRespostas(thetaVerdadeiro, itens, blocos, rng);
        estimativas.push(estimarThetaEAP(comparacoes, 'conscienciosidade', itens).theta);
      }

      const media = estimativas.reduce((acc, t) => acc + t, 0) / estimativas.length;

      // Tolerância de 0,35 na escala θ (desvios-padrão). EAP encolhe em
      // direção ao prior por construção, então nos extremos o viés é
      // esperado e conhecido -- não é erro de implementação.
      expect(Math.abs(media - thetaVerdadeiro)).toBeLessThan(0.35);
    },
  );

  it('a ordenação entre respondentes é preservada (o que a ordenação dentro da vaga usa)', () => {
    const rng = criarRng(99991);
    const verdadeiros = [-2, -1, 0, 1, 2];

    // Média de replicações pelo mesmo motivo do caso acima: UMA aplicação de
    // 40 blocos carrega erro amostral real (SE ~0,3 na escala θ), então dois
    // respondentes vizinhos podem trocar de posição por puro sorteio. Sem a
    // média este caso passa ou falha conforme a semente -- e em θ=1 e θ=2 o
    // banco chega a produzir o MESMO padrão de resposta, que nenhum estimador
    // consegue separar, porque a entrada é idêntica. A média isola a
    // propriedade do estimador do ruído amostral do instrumento; a comparação
    // entre respondentes segue estrita.
    const estimados = verdadeiros.map((tv) => {
      const replicacoes: number[] = [];
      for (let r = 0; r < 30; r++) {
        const comparacoes = simularRespostas(tv, itens, blocos, rng);
        replicacoes.push(estimarThetaEAP(comparacoes, 'conscienciosidade', itens).theta);
      }
      return replicacoes.reduce((acc, t) => acc + t, 0) / replicacoes.length;
    });

    // Sem percentil no ano 1, a ordenação DENTRO da vaga é o que o produto
    // entrega -- então monotonicidade importa mais que calibração absoluta.
    for (let i = 1; i < estimados.length; i++) {
      expect(estimados[i]).toBeGreaterThan(estimados[i - 1]);
    }
  });

  it('mais blocos reduzem o erro-padrão (o instrumento fica mais preciso)', () => {
    const rng = criarRng(4242);

    const curto = montarBanco(10);
    const longo = montarBanco(60);

    const seCurto = estimarThetaEAP(
      simularRespostas(0.5, curto.itens, curto.blocos, rng),
      'conscienciosidade',
      curto.itens,
    ).se;
    const seLongo = estimarThetaEAP(
      simularRespostas(0.5, longo.itens, longo.blocos, rng),
      'conscienciosidade',
      longo.itens,
    ).se;

    expect(seLongo).toBeLessThan(seCurto);
  });

  it('a escoragem de uma aplicação completa roda muito abaixo do SLO de 2s', () => {
    const rng = criarRng(777);
    const comparacoes = simularRespostas(0.3, itens, blocos, rng);

    const inicio = Date.now();
    for (const dimensao of ['conscienciosidade', 'extroversao', 'amabilidade', 'estabilidade', 'abertura']) {
      estimarThetaEAP(comparacoes, dimensao, itens);
    }
    const decorrido = Date.now() - inicio;

    // SLO do roadmap: theta/se disponíveis em < 2s após a última resposta.
    // As 5 dimensões juntas devem ficar em milissegundos.
    expect(decorrido).toBeLessThan(500);
  });
});

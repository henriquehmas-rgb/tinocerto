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

/**
 * Distância entre as duas dificuldades do bloco.
 *
 * ESTE NÚMERO É O QUE TORNA O TESTE CAPAZ DE VER O TERMO DE DIFICULDADE.
 * Num bloco de chaveamento oposto a diferença de utilidade é
 *
 *     u(pos) - u(neg) = a+ (θ - b+) + a- (θ - b-) = (a+ + a-) θ - (a+ b+ + a- b-)
 *
 * com a+ = 1,2 e a- = 1,1. Se o bloco for montado de forma ESPELHADA
 * (b- = -b+, que é o desenho intuitivo), o termo de dificuldade colapsa em
 * (1,2 - 1,1) b+ = 0,1 b+ contra 2,3 θ: `b` praticamente some da conta, todo
 * bloco acaba com limiar efetivo ~0 e o θ verdadeiro domina sozinho. O teste
 * então recupera θ perfeitamente MESMO COM UM ESTIMADOR QUE IGNORA `b` ou
 * que inverte o sinal dele -- verificado por mutação.
 *
 * Deslocando os dois polos NA MESMA DIREÇÃO em torno de um limiar
 * (b+ = L + s, b- = L - s), o termo vira 1,2(L + s) + 1,1(L - s) = 2,3 L +
 * 0,1 s, ou seja o limiar efetivo do bloco é L + 0,026 -- espalhado de
 * verdade pela escala, como o comentário do banco sempre afirmou, e agora
 * identificável.
 */
const SEPARACAO_DIFICULDADE = 0.6;

interface OpcoesBanco {
  /** Dimensão medida por todos os itens do banco. */
  dominio?: string;
  /** Centro da faixa de limiares efetivos (o θ em que o bloco é 50/50). */
  centro?: number;
  /** Prefixo dos ids, para bancos de dimensões diferentes coexistirem. */
  prefixo?: string;
  /** Discriminação do polo positivo do bloco. */
  discriminacaoPositiva?: number;
  /** Discriminação do polo negativo do bloco (entra na utilidade com sinal invertido). */
  discriminacaoNegativa?: number;
  /** Meia-distância entre as duas dificuldades do bloco (ver SEPARACAO_DIFICULDADE). */
  separacao?: number;
}

/** Monta um banco sintético de blocos com chaveamento oposto. */
function montarBanco(
  nBlocos: number,
  opcoes: OpcoesBanco = {},
): { itens: Record<string, ItemNoBloco>; blocos: string[][] } {
  const dominio = opcoes.dominio ?? 'conscienciosidade';
  const centro = opcoes.centro ?? 0;
  const prefixo = opcoes.prefixo ?? 'b';
  const aPositivo = opcoes.discriminacaoPositiva ?? 1.2;
  const aNegativo = opcoes.discriminacaoNegativa ?? 1.1;
  const separacao = opcoes.separacao ?? SEPARACAO_DIFICULDADE;

  const itens: Record<string, ItemNoBloco> = {};
  const blocos: string[][] = [];

  for (let b = 0; b < nBlocos; b++) {
    const idPos = `${prefixo}${b}_pos`;
    const idNeg = `${prefixo}${b}_neg`;

    // Limiares espalhados numa faixa de 3 pontos de θ em torno do centro,
    // para o instrumento ter informação em toda a faixa de interesse.
    const limiar = centro + (-1.5 + (3 * b) / Math.max(nBlocos - 1, 1));

    itens[idPos] = {
      itemId: idPos,
      dominio,
      valencia: 'positivo',
      params: { a: aPositivo, b: limiar + separacao, c: 0 },
    };
    itens[idNeg] = {
      itemId: idNeg,
      dominio,
      valencia: 'negativo',
      params: { a: aNegativo, b: limiar - separacao, c: 0 },
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
        blockId: `${idA}_bloco${indice}`,
        itemIds,
        maisId: escolheA ? idA : idB,
        menosId: escolheA ? idB : idA,
      }),
    );
  });

  return comparacoes;
}

/** Média de várias aplicações independentes do mesmo respondente. */
function mediaRecuperada(
  thetaVerdadeiro: number,
  banco: { itens: Record<string, ItemNoBloco>; blocos: string[][] },
  dimensao: string,
  rng: () => number,
  replicacoes = 30,
): number {
  const estimativas: number[] = [];
  for (let r = 0; r < replicacoes; r++) {
    const comparacoes = simularRespostas(thetaVerdadeiro, banco.itens, banco.blocos, rng);
    estimativas.push(estimarThetaEAP(comparacoes, dimensao, banco.itens).theta);
  }
  return estimativas.reduce((acc, t) => acc + t, 0) / estimativas.length;
}

/**
 * EAP de referência para o padrão em que o polo positivo vence em TODOS os
 * blocos do banco -- recalculado da definição do modelo, sem reaproveitar
 * nada do estimador.
 *
 * Cada bloco de chaveamento oposto contribui com uma logística de ganho
 * k = a+ + a- e deslocamento c = a+ b+ + a- b-. `desvioPrior` fica explícito
 * para deixar claro qual prior está sendo afirmado.
 */
function eapReferencia(
  banco: { itens: Record<string, ItemNoBloco>; blocos: string[][] },
  desvioPrior: number,
): number {
  const termos = banco.blocos.map(([idPos, idNeg]) => {
    const pos = banco.itens[idPos];
    const neg = banco.itens[idNeg];
    return {
      k: pos.params.a + neg.params.a,
      c: pos.params.a * pos.params.b + neg.params.a * neg.params.b,
    };
  });

  const passo = 0.001;
  let soma = 0;
  let somaT = 0;

  for (let t = -8; t <= 8 + 1e-12; t += passo) {
    let logVerossimilhanca = 0;
    for (const termo of termos) {
      logVerossimilhanca += Math.log(1 / (1 + Math.exp(-(termo.k * t - termo.c))));
    }
    const peso = Math.exp(logVerossimilhanca - (0.5 * t * t) / (desvioPrior * desvioPrior));
    soma += peso;
    somaT += t * peso;
  }

  return somaT / soma;
}

describe('recuperação de parâmetro — o estimador devolve o theta que gerou os dados', () => {
  const banco = montarBanco(40);

  it.each([-1.5, -0.75, 0, 0.75, 1.5])(
    'recupera theta verdadeiro = %p dentro da margem esperada',
    (thetaVerdadeiro) => {
      const rng = criarRng(20260730 + Math.round(thetaVerdadeiro * 100));

      // Média de várias replicações: uma única aplicação de 40 blocos tem
      // erro amostral real: é o SE do próprio instrumento, não bug.
      const media = mediaRecuperada(thetaVerdadeiro, banco, 'conscienciosidade', rng);

      // Tolerância de 0,35 na escala θ (desvios-padrão). EAP encolhe em
      // direção ao prior por construção, então nos extremos o viés é
      // esperado e conhecido -- não é erro de implementação. Os erros
      // observados ficam entre 0,016 e 0,059, bem dentro da margem.
      expect(Math.abs(media - thetaVerdadeiro)).toBeLessThan(0.35);
    },
  );

  it.each([0.6, 1.2, 1.8])(
    'recupera theta verdadeiro = %p num banco DESLOCADO, onde a dificuldade não pode ser ignorada',
    (thetaVerdadeiro) => {
      // Este caso existe para fechar o ponto cego do banco centrado. Lá os
      // limiares efetivos são simétricos em torno de 0, e um estimador que
      // ZERASSE `b` ou INVERTESSE O SINAL dele nos dois lados da comparação
      // continua acertando a média, porque os desvios de bloco se cancelam
      // entre si. Deslocando o banco inteiro para um centro de 1,2, o erro
      // do estimador deixa de cancelar e vira viés puro:
      //   - estimador que ignora `b`: erra por ~1,2 (o próprio centro);
      //   - estimador com o sinal de `b` invertido: erra por ~2,4 (o dobro).
      // Ambos muito além da tolerância de 0,35. Verificado por mutação.
      const deslocado = montarBanco(40, { centro: 1.2, prefixo: 'd' });
      const rng = criarRng(20260731 + Math.round(thetaVerdadeiro * 100));

      const media = mediaRecuperada(thetaVerdadeiro, deslocado, 'conscienciosidade', rng);

      // Erros observados com o estimador correto: 0,002 a 0,049.
      expect(Math.abs(media - thetaVerdadeiro)).toBeLessThan(0.35);
    },
  );

  it.each([-1.5, -0.75, 0, 0.75, 1.5])(
    'recupera theta verdadeiro = %p num banco de discriminações DESIGUAIS, onde trocar `b` de item vira viés',
    (thetaVerdadeiro) => {
      // Terceiro e último ponto cego do termo de dificuldade: a ATRIBUIÇÃO de
      // `b` ao item certo. Os dois bancos acima veem a MAGNITUDE e o SINAL de
      // `b`, mas não veem um erro de copiar-e-colar em que cada lado da
      // comparação usa o `b` do OUTRO item. O motivo é aritmético: esse erro
      // desloca a diferença de utilidades por
      //
      //     (aEf_vencedor + aEf_perdedor) (b_vencedor - b_perdedor)
      //
      // enquanto θ entra com ganho (aEf_vencedor - aEf_perdedor). Num bloco de
      // chaveamento oposto o primeiro ganho é (a+ - a-) e o segundo (a+ + a-),
      // então com a+ = 1,2 e a- = 1,1 o erro entra 23x atenuado: 0,1 * 1,2
      // contra 2,3, ou seja 0,052 na escala θ -- invisível sob a tolerância de
      // 0,35.
      //
      // A cura é desbalancear a discriminação dos polos. Com a+ = 1,5 e
      // a- = 0,7 o ganho do erro sobe para 0,8 e o de θ cai para 2,2, e com a
      // separação de dificuldade em 1,0 o deslocamento vira
      // 0,8 * 2,0 / 2,2 = 0,73 na escala θ -- viés puro, igual em todo bloco,
      // que não cancela na média. Verificado por mutação: o estimador correto
      // erra de 0,022 a 0,076; com `b` trocado entre vencedor e perdedor o
      // erro vai a 0,58-0,76 e os cinco casos falham.
      //
      // Bancos reais têm blocos assim: um polo com carga fatorial alta contra
      // um polo fraco é o caso comum, não a exceção.
      const desigual = montarBanco(40, {
        prefixo: 'g',
        discriminacaoPositiva: 1.5,
        discriminacaoNegativa: 0.7,
        separacao: 1.0,
      });
      const rng = criarRng(20260801 + Math.round(thetaVerdadeiro * 100));

      const media = mediaRecuperada(thetaVerdadeiro, desigual, 'conscienciosidade', rng);

      expect(Math.abs(media - thetaVerdadeiro)).toBeLessThan(0.35);
    },
  );

  it('a ordenação entre respondentes é preservada (o que a ordenação dentro da vaga usa)', () => {
    const rng = criarRng(99991);
    const verdadeiros = [-2, -1, 0, 1, 2];

    // UMA aplicação por respondente, de propósito: é exatamente assim que o
    // produto ordena candidatos dentro de uma vaga. Tirar a média de várias
    // replicações removeria justamente a sensibilidade a erro amostral que
    // este caso afirma cobrir. A semente é fixa, então o resultado é
    // reprodutível -- não há risco de falha intermitente.
    const estimados = verdadeiros.map((tv) => {
      const comparacoes = simularRespostas(tv, banco.itens, banco.blocos, rng);
      return estimarThetaEAP(comparacoes, 'conscienciosidade', banco.itens).theta;
    });

    // Sem percentil no ano 1, a ordenação DENTRO da vaga é o que o produto
    // entrega -- então monotonicidade importa mais que calibração absoluta.
    for (let i = 1; i < estimados.length; i++) {
      expect(estimados[i]).toBeGreaterThan(estimados[i - 1]);
    }
  });

  it('padrão de resposta extremo encolhe em direção ao prior (é EAP, não MLE)', () => {
    // O estimador documenta a escolha de EAP sobre MLE assim: "MLE diverge em
    // padrão de resposta extremo (o respondente que escolhe sempre o mesmo
    // polo): a verossimilhança não tem máximo finito". Este caso é o que
    // AFIRMA essa escolha -- sem ele, remover o prior do EAP (degenerando o
    // estimador em MLE truncado na grade) não quebra nada neste arquivo.
    //
    // O respondente aponta o polo positivo como MAIS em todos os 40 blocos.
    // A verossimilhança é monotônica crescente em θ: sem prior, o resultado é
    // decidido só pelo truncamento da grade em +4 e sai em 3,20. Com o prior
    // N(0,1), sai em 2,41.
    const extremo: ComparacaoPar[] = [];
    banco.blocos.forEach((itemIds, indice) => {
      extremo.push(
        ...decomporBlocoEmPares({
          blockId: `extremo${indice}`,
          itemIds,
          maisId: itemIds[0],
          menosId: itemIds[1],
        }),
      );
    });

    const { theta, se } = estimarThetaEAP(extremo, 'conscienciosidade', banco.itens);

    // Âncora ABSOLUTA contra um posterior recalculado do zero (grade de passo
    // 0,001 em ±8 contra 0,1 em ±4, e produto direto em vez de soma de logs),
    // com o prior escrito explicitamente. Uma asserção só de faixa
    // ("θ menor que 3") também mataria a remoção do prior, mas não mataria um
    // prior com o desvio errado; a âncora mata os dois.
    const referencia = eapReferencia(banco, 1);

    // 0,02 de folga: a diferença observada entre a grade grossa do estimador
    // (passo 0,1, truncada em ±4) e a grade fina da referência é de 0,004. Um
    // estimador sem prior sai 0,78 acima -- 39x a folga.
    expect(Math.abs(theta - referencia)).toBeLessThan(0.02);
    // E o padrão extremo continua sendo evidência forte de θ alto: o
    // encolhimento regulariza, não apaga o sinal.
    expect(theta).toBeGreaterThan(2);
    expect(se).toBeGreaterThan(0);
    expect(se).toBeLessThan(1);
  });

  it('mais blocos reduzem o erro-padrão (o instrumento fica mais preciso)', () => {
    const rng = criarRng(4242);

    const curto = montarBanco(10, { prefixo: 'c' });
    const longo = montarBanco(60, { prefixo: 'l' });

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

  it('a escoragem de uma aplicação completa de 5 dimensões roda muito abaixo do SLO de 2s', () => {
    const rng = criarRng(777);
    const dimensoes = ['conscienciosidade', 'extroversao', 'amabilidade', 'estabilidade', 'abertura'];

    // Aplicação completa DE VERDADE: um banco de 40 blocos POR dimensão.
    // Com um banco de dimensão única (todos os itens em 'conscienciosidade'),
    // as outras 4 chamadas filtravam ZERO comparações relevantes e
    // percorriam a grade sem fazer conta nenhuma -- o teste media o custo de
    // UMA dimensão e chamava isso de cinco.
    const itensCompleto: Record<string, ItemNoBloco> = {};
    const comparacoes: ComparacaoPar[] = [];
    dimensoes.forEach((dimensao, d) => {
      const bancoDimensao = montarBanco(40, { dominio: dimensao, prefixo: `s${d}_` });
      Object.assign(itensCompleto, bancoDimensao.itens);
      comparacoes.push(...simularRespostas(0.3, bancoDimensao.itens, bancoDimensao.blocos, rng));
    });

    const inicio = Date.now();
    const resultados = dimensoes.map((dimensao) => estimarThetaEAP(comparacoes, dimensao, itensCompleto));
    const decorrido = Date.now() - inicio;

    // Guarda contra a regressão que esvaziava a medição: cada dimensão
    // precisa ter sido escorada com evidência de verdade. Caindo no prior o
    // SE seria ~1 e o tempo medido não significaria nada.
    for (const resultado of resultados) {
      expect(resultado.se).toBeLessThan(0.5);
    }

    // SLO do roadmap: theta/se disponíveis em < 2s após a última resposta.
    // As 5 dimensões juntas devem ficar em milissegundos.
    expect(decorrido).toBeLessThan(500);
  });
});

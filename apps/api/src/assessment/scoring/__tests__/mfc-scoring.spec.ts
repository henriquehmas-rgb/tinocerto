import { decomporBlocoEmPares, estimarThetaEAP, ItemNoBloco, RespostaBloco } from '../mfc-scoring';

const itens: Record<string, ItemNoBloco> = {
  i1: { itemId: 'i1', dominio: 'conscienciosidade', valencia: 'positivo', params: { a: 1.2, b: 0.0, c: 0 } },
  i2: { itemId: 'i2', dominio: 'conscienciosidade', valencia: 'negativo', params: { a: 1.1, b: 0.0, c: 0 } },
  i3: { itemId: 'i3', dominio: 'extroversao', valencia: 'positivo', params: { a: 1.0, b: 0.5, c: 0 } },

  // Par de chaveamento oposto com discriminação IDÊNTICA. Com `a` igual nos
  // dois polos, a única coisa capaz de produzir theta != 0 é a inversão de
  // sinal da valência -- some a inversão, some o sinal, e theta colapsa em 0.
  // Com o par desbalanceado (i1 a=1,2 contra i2 a=1,1) isso não aconteceria:
  // sobraria a diferença residual de 0,1, que PRESERVA o sinal do theta e
  // esconderia a inversão silenciosa de escore.
  p1: { itemId: 'p1', dominio: 'conscienciosidade', valencia: 'positivo', params: { a: 1.2, b: 0.0, c: 0 } },
  n1: { itemId: 'n1', dominio: 'conscienciosidade', valencia: 'negativo', params: { a: 1.2, b: 0.0, c: 0 } },
  // Igual a n1 em tudo, menos na dificuldade -- isola o termo (theta - b) no
  // lado PERDEDOR da comparação.
  n1d: { itemId: 'n1d', dominio: 'conscienciosidade', valencia: 'negativo', params: { a: 1.2, b: -1.0, c: 0 } },
  // Igual a p1 em tudo, menos na dificuldade -- isola o termo (theta - b) no
  // lado VENCEDOR. Sem este par, um bug que zerasse `b` só do lado do vencedor
  // (metade das comparações reais de qualquer bloco) passaria despercebido.
  p1d: { itemId: 'p1d', dominio: 'conscienciosidade', valencia: 'positivo', params: { a: 1.2, b: 1.0, c: 0 } },

  // Itens FORA da dimensão estimada, ambos com b = 0 e discriminações muito
  // diferentes entre si. Sob a aproximação 1-D (traço fora da dimensão fixo na
  // média do prior), a contribuição deles é a * (0 - 0) = 0 nos dois casos, e
  // portanto a estimativa não pode depender de qual dos dois está no bloco.
  x1: { itemId: 'x1', dominio: 'extroversao', valencia: 'positivo', params: { a: 0.5, b: 0.0, c: 0 } },
  x2: { itemId: 'x2', dominio: 'extroversao', valencia: 'positivo', params: { a: 3.0, b: 0.0, c: 0 } },
};

/**
 * Posterior de referência, recalculado do zero a partir da definição do
 * modelo -- NÃO reaproveita nada do estimador: grade fina (passo 0,0002 em
 * ±10 contra 0,1 em ±4), produto direto em vez de soma de logaritmos, e
 * variância por E[t²] - E[t]² em vez do desvio em torno da média.
 *
 * Existe para ancorar a ESCALA do que o estimador devolve em `se`. Sem uma
 * asserção absoluta, `se` e `se²` são indistinguíveis: todas as demais
 * asserções sobre erro-padrão (se > 0, se cai com mais evidência, se ~ 1 sem
 * evidência) sobrevivem intactas se o estimador passar a devolver a VARIÂNCIA
 * a posteriori no lugar do desvio-padrão -- a clássica confusão entre os dois.
 * A consequência dessa troca é concreta: o critério de parada do CAT compara
 * `se` com um alvo de 0,30, e uma variância de 0,30 corresponde a um
 * desvio-padrão de 0,55, quase o dobro da imprecisão pretendida.
 *
 * `k` é a diferença de discriminação efetiva entre vencedor e perdedor
 * (ex.: i1 positivo a=1,2 contra i2 negativo a=1,1 dá k = 1,2 - (-1,1) = 2,3),
 * `m` é o número de comparações idênticas. Vale só para itens com b = 0.
 */
function posteriorReferencia(k: number, m: number): { media: number; desvio: number; variancia: number } {
  const passo = 0.0002;
  let soma = 0;
  let somaT = 0;
  let somaT2 = 0;

  for (let t = -10; t <= 10 + 1e-12; t += passo) {
    const p = 1 / (1 + Math.exp(-k * t));
    const peso = Math.pow(p, m) * Math.exp(-0.5 * t * t);
    soma += peso;
    somaT += t * peso;
    somaT2 += t * t * peso;
  }

  const media = somaT / soma;
  const variancia = somaT2 / soma - media * media;
  return { media, desvio: Math.sqrt(variancia), variancia };
}

describe('decomporBlocoEmPares', () => {
  it('bloco de 3 itens gera 3 comparações par-a-par', () => {
    const resposta: RespostaBloco = { blockId: 'b1', itemIds: ['i1', 'i2', 'i3'], maisId: 'i1', menosId: 'i3' };
    const pares = decomporBlocoEmPares(resposta);
    expect(pares).toHaveLength(3);
  });

  it('o item escolhido como MAIS vence todos os outros do bloco', () => {
    const resposta: RespostaBloco = { blockId: 'b1', itemIds: ['i1', 'i2', 'i3'], maisId: 'i1', menosId: 'i3' };
    const pares = decomporBlocoEmPares(resposta);

    const deI1 = pares.filter((p) => p.vencedorId === 'i1');
    expect(deI1).toHaveLength(2);
  });

  it('o item escolhido como MENOS perde para todos os outros', () => {
    const resposta: RespostaBloco = { blockId: 'b1', itemIds: ['i1', 'i2', 'i3'], maisId: 'i1', menosId: 'i3' };
    const pares = decomporBlocoEmPares(resposta);

    const perdasDeI3 = pares.filter((p) => p.perdedorId === 'i3');
    expect(perdasDeI3).toHaveLength(2);
  });

  it('rejeita bloco em que mais e menos são o mesmo item', () => {
    const resposta: RespostaBloco = { blockId: 'b1', itemIds: ['i1', 'i2'], maisId: 'i1', menosId: 'i1' };
    expect(() => decomporBlocoEmPares(resposta)).toThrow(/mesmo item/i);
  });

  it('rejeita escolha de item que não está no bloco', () => {
    const resposta: RespostaBloco = { blockId: 'b1', itemIds: ['i1', 'i2'], maisId: 'i1', menosId: 'i9' };
    expect(() => decomporBlocoEmPares(resposta)).toThrow(/não pertence/i);
  });
});

describe('estimarThetaEAP', () => {
  it('quem escolhe o item positivo como MAIS recebe theta acima da média', () => {
    // i1 (positivo, conscienciosidade) vence i2 (negativo, mesma dimensão).
    const pares = decomporBlocoEmPares({
      blockId: 'b1',
      itemIds: ['i1', 'i2'],
      maisId: 'i1',
      menosId: 'i2',
    });

    const { theta } = estimarThetaEAP(pares, 'conscienciosidade', itens);
    // O piso de 0,4 é o que torna esta asserção capaz de detectar a perda do
    // chaveamento negativo. Só `> 0` não serve: sem a inversão de sinal a
    // diferença de utilidade cai de 2,3*theta para 0,1*theta e theta despenca
    // de ~0,64 para ~0,05 -- MESMO SINAL, magnitude 13x menor. O valor
    // correto aqui é 0,6377.
    expect(theta).toBeGreaterThan(0.4);
  });

  it('quem escolhe o item negativo como MAIS recebe theta abaixo da média', () => {
    const pares = decomporBlocoEmPares({
      blockId: 'b1',
      itemIds: ['i1', 'i2'],
      maisId: 'i2',
      menosId: 'i1',
    });

    const { theta } = estimarThetaEAP(pares, 'conscienciosidade', itens);
    // Espelho do caso acima; valor correto -0,6377, versão sem chaveamento
    // -0,05. Ver a justificativa do piso no teste anterior.
    expect(theta).toBeLessThan(-0.4);
  });

  it('com discriminação igual nos dois polos, a valência é a única fonte de sinal do theta', () => {
    // p1 e n1 diferem SOMENTE na valência: mesma dimensão, mesmo a, mesmo b.
    // Se o chaveamento negativo deixar de inverter o sinal de `a`, as duas
    // utilidades ficam idênticas, a diferença vira 0, a verossimilhança fica
    // plana e o EAP devolve exatamente o prior (theta ~ 4e-17) nas DUAS
    // direções de escolha.
    const escolheuPositivo = decomporBlocoEmPares({
      blockId: 'bv1',
      itemIds: ['p1', 'n1'],
      maisId: 'p1',
      menosId: 'n1',
    });
    const escolheuNegativo = decomporBlocoEmPares({
      blockId: 'bv2',
      itemIds: ['p1', 'n1'],
      maisId: 'n1',
      menosId: 'p1',
    });

    const thetaPositivo = estimarThetaEAP(escolheuPositivo, 'conscienciosidade', itens).theta;
    const thetaNegativo = estimarThetaEAP(escolheuNegativo, 'conscienciosidade', itens).theta;

    expect(thetaPositivo).toBeGreaterThan(0.4);
    expect(thetaNegativo).toBeLessThan(-0.4);
    // Com o par perfeitamente balanceado, as duas escolhas são simétricas.
    expect(thetaPositivo).toBeCloseTo(-thetaNegativo, 10);
  });

  it('a estimativa de uma dimensão não depende da discriminação de item de outra dimensão que PERDEU', () => {
    // Exercita a aproximação 1-D declarada no estimador: o traço das dimensões
    // que não estão sendo estimadas fica fixo na média do prior (theta = 0).
    // x1 (a = 0,5) e x2 (a = 3,0) são de 'extroversao' e têm b = 0, então a
    // utilidade de ambos é a * (0 - 0) = 0 -- trocar um pelo outro não pode
    // mexer no theta de 'conscienciosidade'. Se o item de fora entrasse com o
    // theta da dimensão pedida, x2 dominaria i1 (3,0 contra 1,2) e o theta
    // chegaria a MUDAR DE SINAL, contaminando todo bloco entre dimensões.
    const contraX1 = decomporBlocoEmPares({
      blockId: 'bx1',
      itemIds: ['i1', 'x1'],
      maisId: 'i1',
      menosId: 'x1',
    });
    const contraX2 = decomporBlocoEmPares({
      blockId: 'bx2',
      itemIds: ['i1', 'x2'],
      maisId: 'i1',
      menosId: 'x2',
    });

    const thetaContraX1 = estimarThetaEAP(contraX1, 'conscienciosidade', itens).theta;
    const thetaContraX2 = estimarThetaEAP(contraX2, 'conscienciosidade', itens).theta;

    // Escolher o item da dimensão pedida é evidência a favor dela.
    expect(thetaContraX1).toBeGreaterThan(0);
    expect(thetaContraX2).toBeGreaterThan(0);
    // E o parâmetro do item de fora é irrelevante para esta dimensão.
    expect(thetaContraX2).toBeCloseTo(thetaContraX1, 12);
  });

  it('a estimativa de uma dimensão não depende da discriminação de item de outra dimensão que VENCEU', () => {
    // Espelho obrigatório do teste anterior. `decomporBlocoEmPares` emite
    // comparações nas DUAS direções, então num bloco misto real o item de
    // outra dimensão é o vencedor em cerca de metade das comparações
    // geradas -- sempre que o respondente aponta como MAIS um item de outro
    // traço. Se o lado vencedor deixar de fixar o traço de fora em 0, o
    // theta pedido passa a depender do `a` alheio e chega a INVERTER DE
    // SINAL: com x1 (a=0,5) daria -0,31 e com x2 (a=3,0) daria +0,58.
    const venceuX1 = decomporBlocoEmPares({
      blockId: 'bwx1',
      itemIds: ['i1', 'x1'],
      maisId: 'x1',
      menosId: 'i1',
    });
    const venceuX2 = decomporBlocoEmPares({
      blockId: 'bwx2',
      itemIds: ['i1', 'x2'],
      maisId: 'x2',
      menosId: 'i1',
    });

    const thetaVenceuX1 = estimarThetaEAP(venceuX1, 'conscienciosidade', itens).theta;
    const thetaVenceuX2 = estimarThetaEAP(venceuX2, 'conscienciosidade', itens).theta;

    // i1 (positivo, conscienciosidade) perdeu: evidência contra a dimensão.
    expect(thetaVenceuX1).toBeLessThan(0);
    expect(thetaVenceuX2).toBeLessThan(0);
    // O parâmetro do item de fora continua irrelevante quando ele é o vencedor.
    expect(thetaVenceuX2).toBeCloseTo(thetaVenceuX1, 12);
  });

  it('a dificuldade do item PERDEDOR entra na utilidade: mesmo padrão de escolha, b diferente, theta diferente', () => {
    // n1 e n1d só diferem em b (0,0 contra -1,0). Um item de chave negativa
    // mais fácil de endossar (b menor) torna a escolha do polo positivo menos
    // informativa, então o MESMO padrão de resposta tem que render um theta
    // menor. Se o termo (theta - b) sumir da utilidade, os dois casos viram
    // numericamente idênticos.
    const contraB0 = decomporBlocoEmPares({
      blockId: 'bb0',
      itemIds: ['p1', 'n1'],
      maisId: 'p1',
      menosId: 'n1',
    });
    const contraBNegativo = decomporBlocoEmPares({
      blockId: 'bb1',
      itemIds: ['p1', 'n1d'],
      maisId: 'p1',
      menosId: 'n1d',
    });

    const thetaB0 = estimarThetaEAP(contraB0, 'conscienciosidade', itens).theta;
    const thetaBNegativo = estimarThetaEAP(contraBNegativo, 'conscienciosidade', itens).theta;

    // Valores corretos: 0,6468 e 0,4522 -- separação de ~0,19.
    expect(thetaBNegativo).toBeLessThan(thetaB0 - 0.1);
    expect(thetaBNegativo).toBeGreaterThan(0);
  });

  it('a dificuldade do item VENCEDOR entra na utilidade: mesmo padrão de escolha, b diferente, theta diferente', () => {
    // Espelho do teste anterior no outro lado da comparação. p1 e p1d só
    // diferem em b (0,0 contra 1,0) e ambos vencem o mesmo n1. Endossar um
    // item positivo MAIS difícil é evidência mais forte de theta alto, então
    // o mesmo padrão de resposta tem que render um theta MAIOR. Sem esta
    // asserção, zerar `b` só na utilidade do vencedor -- metade das
    // comparações de qualquer bloco -- não quebra nenhum teste.
    const vencedorB0 = decomporBlocoEmPares({
      blockId: 'bw0',
      itemIds: ['p1', 'n1'],
      maisId: 'p1',
      menosId: 'n1',
    });
    const vencedorBAlto = decomporBlocoEmPares({
      blockId: 'bw1',
      itemIds: ['p1d', 'n1'],
      maisId: 'p1d',
      menosId: 'n1',
    });

    const thetaVencedorB0 = estimarThetaEAP(vencedorB0, 'conscienciosidade', itens).theta;
    const thetaVencedorBAlto = estimarThetaEAP(vencedorBAlto, 'conscienciosidade', itens).theta;

    // Valores corretos: 0,6468 e 0,8673 -- separação de ~0,22. Com `b` inerte
    // do lado do vencedor os dois colapsam no mesmo 0,6468.
    expect(thetaVencedorBAlto).toBeGreaterThan(thetaVencedorB0 + 0.1);
  });

  it('sem nenhuma comparação naquela dimensão, devolve o prior (theta 0, SE ~1)', () => {
    const pares = decomporBlocoEmPares({
      blockId: 'b1',
      itemIds: ['i1', 'i2'],
      maisId: 'i1',
      menosId: 'i2',
    });

    // Nenhum item de 'amabilidade' foi respondido.
    const { theta, se } = estimarThetaEAP(pares, 'amabilidade', itens);
    expect(theta).toBeCloseTo(0, 6);
    // ~1, não exatamente 1: a grade é discreta (passo 0,1) e truncada em ±4,
    // então o desvio do prior reconstruído fica em 0,99956. A tolerância é
    // apertada de propósito para PROVAR QUE O CAMINHO NORMAL RODOU: sem
    // comparação relevante a verossimilhança fica plana mas os pesos seguem
    // positivos, então a quadratura roda e reconstrói o prior -- o atalho de
    // "sem evidência" NÃO é acionado aqui, e afrouxar isto para ~1 deixaria os
    // dois caminhos indistinguíveis (e também não separaria 0,99956 do
    // quadrado dele, 0,99912).
    expect(se).toBeCloseTo(0.99956, 4);
  });

  it('quando a verossimilhança sofre underflow em toda a grade, cai no prior sem devolver lixo', () => {
    // Este é o único caminho que aciona o atalho de "sem evidência" do
    // estimador. Não é hipotético: instrumento longo com padrão de resposta
    // contraditório derruba o peso de TODOS os pontos da grade a zero em
    // ponto flutuante. Aqui, 800 blocos afirmando p1 > n1 e outros 800
    // afirmando n1 > p1: no melhor ponto da grade o peso é 0,25^800, muito
    // abaixo do menor subnormal representável.
    const contraditorio = [
      ...Array.from({ length: 800 }, (_, n) =>
        decomporBlocoEmPares({ blockId: `pa${n}`, itemIds: ['p1', 'n1'], maisId: 'p1', menosId: 'n1' }),
      ).flat(),
      ...Array.from({ length: 800 }, (_, n) =>
        decomporBlocoEmPares({ blockId: `pb${n}`, itemIds: ['p1', 'n1'], maisId: 'n1', menosId: 'p1' }),
      ).flat(),
    ];

    const { theta, se } = estimarThetaEAP(contraditorio, 'conscienciosidade', itens);

    // O resultado honesto é o prior cheio, não uma divisão 0/0 nem um SE
    // negativo -- e é justamente aqui que um SE negativo poderia escapar,
    // porque este é o único retorno que não passa por Math.sqrt.
    expect(theta).toBe(0);
    expect(se).toBe(1);
  });

  it('mais evidência na mesma direção reduz o erro-padrão', () => {
    const umBloco = decomporBlocoEmPares({ blockId: 'b1', itemIds: ['i1', 'i2'], maisId: 'i1', menosId: 'i2' });
    const seUm = estimarThetaEAP(umBloco, 'conscienciosidade', itens).se;

    // Cinco blocos equivalentes, todos apontando na mesma direção.
    const varios = [0, 1, 2, 3, 4].flatMap((n) =>
      decomporBlocoEmPares({ blockId: `b${n}`, itemIds: ['i1', 'i2'], maisId: 'i1', menosId: 'i2' }),
    );
    const seVarios = estimarThetaEAP(varios, 'conscienciosidade', itens).se;

    expect(seVarios).toBeLessThan(seUm);
  });

  it('o `se` devolvido é o desvio-padrão a posteriori, não a variância', () => {
    // Ancoragem absoluta da escala do erro-padrão contra um posterior
    // recalculado do zero (ver posteriorReferencia). Todas as outras
    // asserções sobre `se` são invariantes a elevar ao quadrado, então sem
    // esta o estimador poderia devolver a variância e nada acusaria -- e o
    // critério de parada do CAT (se < 0,30) pararia o teste adaptativo com
    // metade da precisão pretendida.
    const umBloco = decomporBlocoEmPares({ blockId: 'b1', itemIds: ['i1', 'i2'], maisId: 'i1', menosId: 'i2' });
    const cincoBlocos = [0, 1, 2, 3, 4].flatMap((n) =>
      decomporBlocoEmPares({ blockId: `b${n}`, itemIds: ['i1', 'i2'], maisId: 'i1', menosId: 'i2' }),
    );

    // k = a efetivo do vencedor - a efetivo do perdedor = 1,2 - (-1,1) = 2,3.
    const refUm = posteriorReferencia(2.3, 1);
    const refCinco = posteriorReferencia(2.3, 5);

    const um = estimarThetaEAP(umBloco, 'conscienciosidade', itens);
    const cinco = estimarThetaEAP(cincoBlocos, 'conscienciosidade', itens);

    // Tolerância de 0,005: a diferença observada entre a grade grossa do
    // estimador (passo 0,1 em ±4) e a grade fina da referência é da ordem de
    // 0,0009. Confundir desvio com variância desloca 0,770 para 0,593 e
    // 0,606 para 0,367 -- duas ordens de grandeza acima da tolerância.
    expect(um.theta).toBeCloseTo(refUm.media, 2);
    expect(um.se).toBeCloseTo(refUm.desvio, 2);
    expect(cinco.theta).toBeCloseTo(refCinco.media, 2);
    expect(cinco.se).toBeCloseTo(refCinco.desvio, 2);

    // E a relação entre as duas quantidades, dita explicitamente.
    expect(um.se * um.se).toBeCloseTo(refUm.variancia, 2);
    expect(cinco.se * cinco.se).toBeCloseTo(refCinco.variancia, 2);
  });

  it('nunca devolve NaN nem SE negativo, mesmo com evidência extrema', () => {
    const extremo = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) =>
      decomporBlocoEmPares({ blockId: `b${n}`, itemIds: ['i1', 'i2'], maisId: 'i1', menosId: 'i2' }),
    );
    const { theta, se } = estimarThetaEAP(extremo, 'conscienciosidade', itens);

    expect(Number.isFinite(theta)).toBe(true);
    expect(Number.isFinite(se)).toBe(true);
    expect(se).toBeGreaterThan(0);
  });
});

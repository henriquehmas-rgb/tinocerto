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
  // Igual a n1 em tudo, menos na dificuldade -- isola o termo (theta - b).
  n1d: { itemId: 'n1d', dominio: 'conscienciosidade', valencia: 'negativo', params: { a: 1.2, b: -1.0, c: 0 } },

  // Itens FORA da dimensão estimada, ambos com b = 0 e discriminações muito
  // diferentes entre si. Sob a aproximação 1-D (traço fora da dimensão fixo na
  // média do prior), a contribuição deles é a * (0 - 0) = 0 nos dois casos, e
  // portanto a estimativa não pode depender de qual dos dois está no bloco.
  x1: { itemId: 'x1', dominio: 'extroversao', valencia: 'positivo', params: { a: 0.5, b: 0.0, c: 0 } },
  x2: { itemId: 'x2', dominio: 'extroversao', valencia: 'positivo', params: { a: 3.0, b: 0.0, c: 0 } },
};

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

  it('a estimativa de uma dimensão não depende da discriminação de itens de outra dimensão', () => {
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

  it('a dificuldade do item entra na utilidade: mesmo padrão de escolha, b diferente, theta diferente', () => {
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

  it('sem nenhuma comparação naquela dimensão, devolve o prior (theta 0, SE 1)', () => {
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
    // então o desvio do prior reconstruído fica em ~0,999. Tolerância de
    // 0,05 em vez de 0,005 para o teste medir a propriedade certa (devolveu
    // o prior) em vez da precisão da quadratura.
    expect(se).toBeCloseTo(1, 1);
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

import { decomporBlocoEmPares, estimarThetaEAP, ItemNoBloco, RespostaBloco } from '../mfc-scoring';

const itens: Record<string, ItemNoBloco> = {
  i1: { itemId: 'i1', dominio: 'conscienciosidade', valencia: 'positivo', params: { a: 1.2, b: 0.0, c: 0 } },
  i2: { itemId: 'i2', dominio: 'conscienciosidade', valencia: 'negativo', params: { a: 1.1, b: 0.0, c: 0 } },
  i3: { itemId: 'i3', dominio: 'extroversao', valencia: 'positivo', params: { a: 1.0, b: 0.5, c: 0 } },
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
    expect(theta).toBeGreaterThan(0);
  });

  it('quem escolhe o item negativo como MAIS recebe theta abaixo da média', () => {
    const pares = decomporBlocoEmPares({
      blockId: 'b1',
      itemIds: ['i1', 'i2'],
      maisId: 'i2',
      menosId: 'i1',
    });

    const { theta } = estimarThetaEAP(pares, 'conscienciosidade', itens);
    expect(theta).toBeLessThan(0);
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

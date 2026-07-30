import { probabilidadeAcerto, informacaoFisher, ItemParams } from '../irt-primitives';

describe('primitivas TRI', () => {
  const item2PL: ItemParams = { a: 1.0, b: 0.0, c: 0 };

  it('no 2PL, theta igual à dificuldade dá probabilidade 0,5', () => {
    expect(probabilidadeAcerto(0, item2PL)).toBeCloseTo(0.5, 10);
  });

  it('probabilidade é monotônica crescente em theta', () => {
    const baixo = probabilidadeAcerto(-2, item2PL);
    const meio = probabilidadeAcerto(0, item2PL);
    const alto = probabilidadeAcerto(2, item2PL);
    expect(baixo).toBeLessThan(meio);
    expect(meio).toBeLessThan(alto);
  });

  it('discriminação maior deixa a curva mais íngreme perto de b', () => {
    const suave: ItemParams = { a: 0.5, b: 0, c: 0 };
    const ingreme: ItemParams = { a: 2.0, b: 0, c: 0 };
    // Meio desvio acima de b: o item mais discriminativo separa mais.
    expect(probabilidadeAcerto(0.5, ingreme)).toBeGreaterThan(probabilidadeAcerto(0.5, suave));
  });

  it('no 3PL, a probabilidade nunca cai abaixo do acerto ao acaso', () => {
    const item3PL: ItemParams = { a: 1.2, b: 0, c: 0.25 };
    // Mesmo em theta muito baixo, o piso é c. A curva só encosta em c no
    // limite theta -> -infinito, então a convergência é aferida na cauda:
    // em theta = -6 o valor verdadeiro ainda está 5,6e-4 acima do piso.
    expect(probabilidadeAcerto(-10, item3PL)).toBeGreaterThanOrEqual(0.25);
    expect(probabilidadeAcerto(-10, item3PL)).toBeCloseTo(0.25, 3);
  });

  it('informação de Fisher é máxima em theta = b (caso 2PL)', () => {
    const emB = informacaoFisher(0, item2PL);
    expect(emB).toBeGreaterThan(informacaoFisher(-1.5, item2PL));
    expect(emB).toBeGreaterThan(informacaoFisher(1.5, item2PL));
    // Para 2PL com a=1: I(b) = a^2 * 0.5 * 0.5 = 0.25
    expect(emB).toBeCloseTo(0.25, 10);
  });

  it('informação cresce com o quadrado da discriminação', () => {
    const a1 = informacaoFisher(0, { a: 1, b: 0, c: 0 });
    const a2 = informacaoFisher(0, { a: 2, b: 0, c: 0 });
    // I = a^2 * P * Q, com P=Q=0.5 nos dois casos -> razão = 4.
    expect(a2 / a1).toBeCloseTo(4, 10);
  });

  it('informação é sempre não-negativa, inclusive nos extremos', () => {
    for (const theta of [-8, -3, 0, 3, 8]) {
      expect(informacaoFisher(theta, { a: 1.5, b: 0.4, c: 0.2 })).toBeGreaterThanOrEqual(0);
    }
  });
});

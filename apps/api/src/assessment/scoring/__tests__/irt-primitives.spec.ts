import { probabilidadeAcerto, informacaoFisher, ItemParams } from '../irt-primitives';

describe('primitivas TRI', () => {
  const item2PL: ItemParams = { a: 1.0, b: 0.0, c: 0 };
  const item3PL: ItemParams = { a: 1.2, b: 0.0, c: 0.25 };

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
    // Mesmo em theta muito baixo, o piso é c. A curva só encosta em c no
    // limite theta -> -infinito, então a convergência é aferida na cauda:
    // em theta = -6 o valor verdadeiro ainda está 5,6e-4 acima do piso.
    expect(probabilidadeAcerto(-10, item3PL)).toBeGreaterThanOrEqual(0.25);
    expect(probabilidadeAcerto(-10, item3PL)).toBeCloseTo(0.25, 3);
  });

  it('no 3PL, a probabilidade continua sendo probabilidade — o teto é 1', () => {
    // O piso c encolhe a amplitude da logística para (1 - c). Sem esse fator
    // de escala, P estouraria 1 na cauda alta (0,25 + 0,973 = 1,22) e a
    // informação de Fisher passaria a ser calculada sobre um Q negativo,
    // que a guarda numérica engoliria em silêncio.
    for (const theta of [0, 1, 3, 6, 10]) {
      expect(probabilidadeAcerto(theta, item3PL)).toBeLessThanOrEqual(1);
    }
    // Valores analíticos de P(theta) = c + (1 - c)/(1 + exp(-a(theta - b))).
    expect(probabilidadeAcerto(0, item3PL)).toBeCloseTo(0.625, 12);
    expect(probabilidadeAcerto(3, item3PL)).toBeCloseTo(0.980052254817350477, 12);
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

  it('com c > 0 a informação segue a forma de Birnbaum, não a do 2PL', () => {
    // I(theta) = a^2 * (Q/P) * [(P - c)/(1 - c)]^2
    // Em theta = b = 0, com a = 1,2 e c = 0,25: P = 0,625, Q = 0,375 e
    // (P - c)/(1 - c) = 0,5 -> I = 1,44 * 0,6 * 0,25 = 0,216.
    // A forma do 2PL (a^2 * P * Q) daria 0,3375 no mesmo ponto: é isso que
    // separa as duas implementações e trava a seleção de itens do CAT, que
    // escolhe justamente pelo máximo desta função.
    expect(informacaoFisher(0, item3PL)).toBeCloseTo(0.216, 10);
    expect(informacaoFisher(1, item3PL)).toBeCloseTo(0.178672235135493518, 12);
  });

  it('informação bate com o valor analítico nos extremos, e nunca é negativa', () => {
    const item: ItemParams = { a: 1.5, b: 0.4, c: 0.2 };
    // Referência calculada à parte pela forma equivalente e independente
    // I(theta) = [P'(theta)]^2 / (P*Q), com P'(theta) = a(1 - c)L(1 - L).
    const esperado: Array<[number, number]> = [
      [-8, 1.02331965185982204e-10],
      [-3, 3.20714181629826785e-4],
      [0, 0.301820918743316513],
      [3, 3.48628642024340837e-2],
      [8, 2.0151376383181533e-5],
    ];
    for (const [theta, valor] of esperado) {
      const obtido = informacaoFisher(theta, item);
      expect(obtido).toBeGreaterThanOrEqual(0);
      // Comparação relativa: a informação varia nove ordens de grandeza entre
      // o centro e a cauda, e uma tolerância absoluta não morderia nas pontas.
      expect(obtido / valor).toBeCloseTo(1, 10);
    }
  });
});

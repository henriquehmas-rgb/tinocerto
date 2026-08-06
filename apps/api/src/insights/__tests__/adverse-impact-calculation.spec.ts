import { calcularRazoes4Quintos, LIMIAR_MINIMO_GRUPO } from '../adverse-impact-calculation';

describe('calcularRazoes4Quintos', () => {
  it('grupo com taxa igual ao maior recebe razão 1.0', () => {
    const resultado = calcularRazoes4Quintos([
      { categoria: 'a', alcancaram: 10, totalGrupo: 20 },
      { categoria: 'b', alcancaram: 10, totalGrupo: 20 },
    ]);
    expect(resultado.find((r) => r.categoria === 'a')?.razao4Quintos).toBe(1);
    expect(resultado.find((r) => r.categoria === 'b')?.razao4Quintos).toBe(1);
  });

  it('detecta impacto adverso conhecido: grupo minoritário com metade da taxa do majoritário', () => {
    // taxa_a = 40/100 = 0.4 (referência, maior taxa)
    // taxa_b = 8/40 = 0.2 -- razão = 0.2/0.4 = 0.5, abaixo de 0.8
    const resultado = calcularRazoes4Quintos([
      { categoria: 'majoritario', alcancaram: 40, totalGrupo: 100 },
      { categoria: 'minoritario', alcancaram: 8, totalGrupo: 40 },
    ]);
    const minoritario = resultado.find((r) => r.categoria === 'minoritario')!;
    expect(minoritario.taxaSelecao).toBeCloseTo(0.2, 4);
    expect(minoritario.razao4Quintos).toBeCloseTo(0.5, 4);
    expect(minoritario.razao4Quintos).toBeLessThan(0.8);
  });

  it('grupo abaixo do limiar mínimo não aparece no resultado', () => {
    expect(LIMIAR_MINIMO_GRUPO).toBe(5);
    const resultado = calcularRazoes4Quintos([
      { categoria: 'grande', alcancaram: 10, totalGrupo: 20 },
      { categoria: 'pequeno_demais', alcancaram: 1, totalGrupo: 3 },
    ]);
    expect(resultado.map((r) => r.categoria)).toEqual(['grande']);
  });

  it('lista vazia (nenhum grupo com amostra suficiente) devolve lista vazia, não erro', () => {
    const resultado = calcularRazoes4Quintos([{ categoria: 'pequeno', alcancaram: 1, totalGrupo: 2 }]);
    expect(resultado).toEqual([]);
  });

  it('ninguém alcançou a etapa (todas as taxas zero) devolve razão 0, não NaN', () => {
    const resultado = calcularRazoes4Quintos([
      { categoria: 'a', alcancaram: 0, totalGrupo: 10 },
      { categoria: 'b', alcancaram: 0, totalGrupo: 10 },
    ]);
    expect(resultado.every((r) => r.taxaSelecao === 0 && r.razao4Quintos === 0)).toBe(true);
    expect(resultado.some((r) => Number.isNaN(r.razao4Quintos))).toBe(false);
  });
});

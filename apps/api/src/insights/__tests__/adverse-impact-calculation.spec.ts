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

  it('ninguém alcançou a etapa (todas as taxas zero) devolve lista vazia -- sem disparidade real para relatar, não um alarme de severidade máxima', () => {
    // Achado de re-revisão adversarial da Task 4: a versão anterior desta
    // função devolvia razão 0 para todo mundo neste caso -- quando o
    // AdverseImpactSnapshotService passou a alcançar de verdade este
    // ramo (candidatos sem autodeclaração avançando sozinhos numa
    // etapa), isso virava um alarme falso de impacto adverso MÁXIMO sem
    // nenhuma disparidade real entre os grupos declarados. Lista vazia é
    // a resposta honesta: "sem dado suficiente", não "pior caso
    // possível". Nunca NaN de qualquer forma.
    const resultado = calcularRazoes4Quintos([
      { categoria: 'a', alcancaram: 0, totalGrupo: 10 },
      { categoria: 'b', alcancaram: 0, totalGrupo: 10 },
    ]);
    expect(resultado).toEqual([]);
  });

  it('grupos mistos: um com taxa zero, outro não -- não é tratado como caso especial "ninguém alcançou"', () => {
    // Achado de revisão adversarial: o branch `maxTaxa === 0` só existe
    // para o caso de TODOS os grupos zerados. Este teste prova que um
    // grupo zerado ao lado de um grupo não-zerado usa a divisão normal
    // (0/maxTaxa = 0), não o branch especial -- e que o grupo não-zerado
    // não é afetado pela presença do grupo zerado.
    const resultado = calcularRazoes4Quintos([
      { categoria: 'zerado', alcancaram: 0, totalGrupo: 10 },
      { categoria: 'nao_zerado', alcancaram: 5, totalGrupo: 10 },
    ]);
    const zerado = resultado.find((r) => r.categoria === 'zerado')!;
    const naoZerado = resultado.find((r) => r.categoria === 'nao_zerado')!;
    expect(zerado.taxaSelecao).toBe(0);
    expect(zerado.razao4Quintos).toBe(0);
    expect(naoZerado.taxaSelecao).toBe(0.5);
    expect(naoZerado.razao4Quintos).toBe(1); // é o maior (único não-zero), referência de si mesmo
  });
});

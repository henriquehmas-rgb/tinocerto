import { locateVerbatimOffset } from '../locate-verbatim-offset';

describe('locateVerbatimOffset', () => {
  const texto = 'Analista de Operações na Empresa Exemplo, responsável por processos de 2020 a 2023.';

  it('localiza uma citação que existe verbatim no texto', () => {
    const result = locateVerbatimOffset(texto, 'Analista de Operações na Empresa Exemplo');
    expect(result).not.toBeNull();
    expect(texto.slice(result!.offsetInicio, result!.offsetFim)).toBe('Analista de Operações na Empresa Exemplo');
  });

  it('retorna null para uma citação que não existe verbatim (paráfrase do modelo)', () => {
    const result = locateVerbatimOffset(texto, 'Trabalhou como analista de operações');
    expect(result).toBeNull();
  });

  it('localiza a citação mesmo perto do fim do texto', () => {
    const result = locateVerbatimOffset(texto, 'de 2020 a 2023');
    expect(result).not.toBeNull();
    expect(texto.slice(result!.offsetInicio, result!.offsetFim)).toBe('de 2020 a 2023');
  });
});

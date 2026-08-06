import { calcularScoreAderencia } from '../adherence-scoring';

describe('calcularScoreAderencia', () => {
  it('vaga sem requisito declarado devolve score null, não 0 nem 100', () => {
    const resultado = calcularScoreAderencia([], ['TypeScript']);
    expect(resultado).toEqual({ scoreAderencia: null, skillsBatidas: [], skillsFaltantes: [], totalExigidas: 0 });
  });

  it('candidato sem nenhuma skill bate zero de N exigidas', () => {
    const resultado = calcularScoreAderencia(['TypeScript', 'PostgreSQL'], []);
    expect(resultado.scoreAderencia).toBe(0);
    expect(resultado.skillsFaltantes).toEqual(['TypeScript', 'PostgreSQL']);
    expect(resultado.skillsBatidas).toEqual([]);
    expect(resultado.totalExigidas).toBe(2);
  });

  it('bate 100% quando todas as skills exigidas estão no perfil, usando a grafia do perfil nas batidas', () => {
    const resultado = calcularScoreAderencia(['typescript', 'postgresql'], ['TypeScript', 'PostgreSQL']);
    expect(resultado.scoreAderencia).toBe(100);
    expect(resultado.skillsBatidas).toEqual(['TypeScript', 'PostgreSQL']);
    expect(resultado.skillsFaltantes).toEqual([]);
  });

  it('normaliza acento e caixa antes de comparar', () => {
    const resultado = calcularScoreAderencia(['Não Técnica: Comunicação'], ['nao tecnica: comunicacao']);
    expect(resultado.scoreAderencia).toBe(100);
  });

  it('match parcial: conta só as que batem, mantém a grafia da vaga nas faltantes', () => {
    const resultado = calcularScoreAderencia(
      ['TypeScript', 'Kubernetes', 'PostgreSQL'],
      ['typescript', 'postgresql avançado'],
    );
    // "postgresql avançado" != "postgresql" pós-normalização -- limite
    // conhecido documentado no design (sem fuzzy match).
    expect(resultado.scoreAderencia).toBe(33);
    expect(resultado.skillsBatidas).toEqual(['typescript']);
    expect(resultado.skillsFaltantes).toEqual(['Kubernetes', 'PostgreSQL']);
    expect(resultado.totalExigidas).toBe(3);
  });
});

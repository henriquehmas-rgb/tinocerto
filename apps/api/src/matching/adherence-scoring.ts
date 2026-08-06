export interface ScoreAderencia {
  scoreAderencia: number | null;
  skillsBatidas: string[];
  skillsFaltantes: string[];
  totalExigidas: number;
}

// Normalização determinística, em TypeScript puro (não SQL) -- consistente
// com a função de cálculo ser pura por assinatura (allowlist estrutural,
// Task 3). Sem dependência de extensão do Postgres.
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // remove marcas diacríticas pós-decomposição NFD
    .trim()
    .toLowerCase();
}

/**
 * Overlap exato pós-normalização entre o que a vaga exige e o que o
 * candidato declara ter. Não é fuzzy nem semântico, de propósito -- ver
 * LIMITE CONHECIDO no design da Fase 2b: sinônimos e abreviações não batem.
 */
export function calcularScoreAderencia(
  habilidadesExigidas: string[],
  habilidadesCandidato: string[],
): ScoreAderencia {
  if (habilidadesExigidas.length === 0) {
    return { scoreAderencia: null, skillsBatidas: [], skillsFaltantes: [], totalExigidas: 0 };
  }

  const candidatoPorNormalizado = new Map<string, string>();
  for (const habilidade of habilidadesCandidato) {
    candidatoPorNormalizado.set(normalizar(habilidade), habilidade);
  }

  const skillsBatidas: string[] = [];
  const skillsFaltantes: string[] = [];
  for (const exigida of habilidadesExigidas) {
    const match = candidatoPorNormalizado.get(normalizar(exigida));
    if (match !== undefined) {
      skillsBatidas.push(match);
    } else {
      skillsFaltantes.push(exigida);
    }
  }

  const scoreAderencia = Math.round((100 * skillsBatidas.length) / habilidadesExigidas.length);
  return { scoreAderencia, skillsBatidas, skillsFaltantes, totalExigidas: habilidadesExigidas.length };
}

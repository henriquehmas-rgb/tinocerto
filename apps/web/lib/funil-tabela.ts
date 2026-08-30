import type { CandidaturaResumo } from './staff-panel-client';

export type ColunaOrdenavel = 'nome' | 'etapa' | 'fit' | 'idade';
export type LinhaFunil = CandidaturaResumo & { etapa: string };

export function achatarFunil(funil: Record<string, CandidaturaResumo[]>): LinhaFunil[] {
  const linhas: LinhaFunil[] = [];
  for (const [etapa, candidaturas] of Object.entries(funil)) {
    for (const candidatura of candidaturas) {
      linhas.push({ ...candidatura, etapa });
    }
  }
  return linhas;
}

const UM_DIA_EM_MS = 24 * 60 * 60 * 1000;

function diasDesde(criadoEm: string, agora: Date): number {
  return Math.floor((agora.getTime() - new Date(criadoEm).getTime()) / UM_DIA_EM_MS);
}

// Compara dois valores possivelmente nulos: nulo sempre por último,
// independente da direção -- fit/idade ausente é "não sabemos", não "menor
// valor". Só quando os dois são não-nulos a direção importa de verdade.
function compararComNuloPorUltimo(a: number | null, b: number | null, direcao: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direcao === 'asc' ? a - b : b - a;
}

export function ordenarCandidaturas(
  linhas: LinhaFunil[],
  ordenacao: { coluna: ColunaOrdenavel; direcao: 'asc' | 'desc' } | null,
  agora: Date,
  ordemEtapas: string[],
): LinhaFunil[] {
  if (ordenacao === null) return linhas;
  const { coluna, direcao } = ordenacao;
  const sinal = direcao === 'asc' ? 1 : -1;

  return [...linhas].sort((x, y) => {
    if (coluna === 'nome') {
      return sinal * x.nomeCandidato.localeCompare(y.nomeCandidato, 'pt-BR');
    }
    if (coluna === 'fit') {
      return compararComNuloPorUltimo(x.scoreAderencia, y.scoreAderencia, direcao);
    }
    if (coluna === 'idade') {
      return compararComNuloPorUltimo(diasDesde(x.criadoEm, agora), diasDesde(y.criadoEm, agora), direcao);
    }
    // coluna === 'etapa': posição na ordem conhecida: nunca inventa a
    // posição de uma etapa fora de ordemEtapas (mesma regra da conversão
    // por etapa na R2a) -- etapa desconhecida vai por último, ordenada por
    // nome entre si.
    const posX = ordemEtapas.indexOf(x.etapa);
    const posY = ordemEtapas.indexOf(y.etapa);
    if (posX === -1 && posY === -1) return sinal * x.etapa.localeCompare(y.etapa, 'pt-BR');
    if (posX === -1) return 1;
    if (posY === -1) return -1;
    return sinal * (posX - posY);
  });
}

export function paginar<T>(itens: T[], pagina: number, porPagina: number): { pagina: T[]; totalPaginas: number } {
  const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina));
  const inicio = (pagina - 1) * porPagina;
  return { pagina: itens.slice(inicio, inicio + porPagina), totalPaginas };
}

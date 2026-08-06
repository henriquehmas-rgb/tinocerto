export interface ContagemCategoria {
  categoria: string;
  alcancaram: number;
  totalGrupo: number;
}

export interface RazaoCategoria {
  categoria: string;
  taxaSelecao: number;
  razao4Quintos: number;
}

// Com amostra menor que isto, uma única candidatura muda a taxa em ±20
// pontos percentuais ou mais -- apresentar isso como sinal estatístico
// seria enganoso. Não é limiar validado estatisticamente (a regra dos 4/5
// não fixa um mínimo legal), é salvaguarda de engenharia contra ruído
// óbvio. Constante fixa nesta fase, não configurável por tenant (YAGNI).
export const LIMIAR_MINIMO_GRUPO = 5;

/**
 * Regra EEOC clássica dos 4/5: para cada categoria dentro de UMA dimensão
 * (ex.: as categorias de gênero numa mesma etapa da mesma vaga -- nunca
 * misturar dimensões diferentes), a razão é a taxa do grupo dividida pela
 * MAIOR taxa entre os grupos. Abaixo de 0.8 sinaliza impacto adverso
 * potencial. O grupo de maior taxa recebe razão 1.0 por definição.
 */
export function calcularRazoes4Quintos(categorias: ContagemCategoria[]): RazaoCategoria[] {
  const validas = categorias.filter((c) => c.totalGrupo >= LIMIAR_MINIMO_GRUPO);
  if (validas.length === 0) return [];

  const taxas = validas.map((c) => ({ categoria: c.categoria, taxa: c.alcancaram / c.totalGrupo }));
  const maxTaxa = Math.max(...taxas.map((t) => t.taxa));

  if (maxTaxa === 0) {
    return taxas.map((t) => ({ categoria: t.categoria, taxaSelecao: 0, razao4Quintos: 0 }));
  }

  return taxas.map((t) => ({
    categoria: t.categoria,
    taxaSelecao: Math.round(t.taxa * 10000) / 10000,
    razao4Quintos: Math.round((t.taxa / maxTaxa) * 10000) / 10000,
  }));
}

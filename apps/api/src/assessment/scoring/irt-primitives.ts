/**
 * Primitivas de Teoria de Resposta ao Item (TRI).
 *
 * Implementadas à mão, em TypeScript puro, de propósito: é o núcleo
 * científico do produto e precisa ser auditável linha a linha por quem
 * entende de psicometria. São fórmulas fechadas de ~30 linhas -- uma
 * biblioteca traria seu próprio modelo de dados e custaria mais do que
 * economiza.
 */

export interface ItemParams {
  /** Discriminação: quão bem o item separa níveis próximos do traço. */
  a: number;
  /** Dificuldade / posição do item na escala do traço. */
  b: number;
  /** Acerto ao acaso (piso da curva). 0 no 2PL. */
  c: number;
}

/**
 * Modelo logístico de 3 parâmetros (3PL). Com c = 0 reduz ao 2PL, e com
 * c = 0 e a = 1 ao 1PL/Rasch -- por isso uma função só cobre os três.
 *
 *   P(θ) = c + (1 - c) / (1 + exp(-a(θ - b)))
 */
export function probabilidadeAcerto(theta: number, params: ItemParams): number {
  const { a, b, c } = params;
  const logistica = 1 / (1 + Math.exp(-a * (theta - b)));
  return c + (1 - c) * logistica;
}

/**
 * Informação de Fisher do item em θ -- quanto aquele item reduz a incerteza
 * sobre o traço naquele ponto da escala. É o critério de seleção do CAT
 * (Task 9): o próximo item é o que maximiza isto no θ estimado até aqui.
 *
 * Forma geral do 3PL:
 *   I(θ) = a² · (Q/P) · [(P - c)/(1 - c)]²
 *
 * Com c = 0 isso colapsa na forma conhecida do 2PL, I(θ) = a²·P·Q.
 */
export function informacaoFisher(theta: number, params: ItemParams): number {
  const { a, c } = params;
  const p = probabilidadeAcerto(theta, params);
  const q = 1 - p;

  // Guarda numérica: em θ extremo, p satura em 0 ou 1 e a divisão explode.
  // A informação tende a 0 nesses extremos, então devolver 0 é o limite
  // correto -- não um atalho.
  if (p <= Number.EPSILON || q <= Number.EPSILON || c >= 1) {
    return 0;
  }

  const razao = (p - c) / (1 - c);
  return a * a * (q / p) * razao * razao;
}

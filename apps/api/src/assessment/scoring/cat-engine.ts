import { informacaoFisher, ItemParams } from './irt-primitives';

export interface BlocoCandidato {
  blockId: string;
  itemParams: ItemParams[];
  /** Proporção de aplicações em que este bloco já foi usado (0-1). */
  taxaExposicao: number;
}

export interface EstadoParada {
  se: number;
  itensAplicados: number;
  segundosDecorridos: number;
}

export interface CriteriosParada {
  seAlvo: number;
  tetoItens: number;
  tetoSegundos: number;
}

export interface OpcoesExposicao {
  /** Teto de Sympson-Hetter: bloco acima disso é evitado. */
  rMax?: number;
}

/**
 * Informação total do bloco em θ -- a soma das informações de Fisher dos
 * itens que o compõem.
 */
function informacaoDoBloco(theta: number, bloco: BlocoCandidato): number {
  return bloco.itemParams.reduce((acc, params) => acc + informacaoFisher(theta, params), 0);
}

/**
 * Seleciona o próximo bloco por MÁXIMA INFORMAÇÃO DE FISHER no θ estimado
 * até aqui, com controle de exposição Sympson-Hetter.
 *
 * NOTA: só é chamado quando instrument_version.modo_administracao = 'cat',
 * que por sua vez é bloqueado no banco enquanto houver parâmetro provisório
 * (assessment_0006). Selecionar por informação sobre parâmetros de
 * literatura escolheria itens errados e contaminaria a calibração futura.
 */
export function selecionarProximoBloco(
  theta: number,
  candidatos: BlocoCandidato[],
  jaAplicados: string[],
  opcoes: OpcoesExposicao = {},
): BlocoCandidato | null {
  const rMax = opcoes.rMax ?? 1;

  const elegiveis = candidatos.filter((b) => !jaAplicados.includes(b.blockId));
  if (elegiveis.length === 0) return null;

  // Primeiro tenta respeitar o teto de exposição. Se o teto zerar as
  // opções, cai para o conjunto completo -- é melhor aplicar um bloco
  // super-exposto do que interromper a aplicação do candidato.
  const dentroDoTeto = elegiveis.filter((b) => b.taxaExposicao <= rMax);
  const pool = dentroDoTeto.length > 0 ? dentroDoTeto : elegiveis;

  return pool.reduce((melhor, atual) =>
    informacaoDoBloco(theta, atual) > informacaoDoBloco(theta, melhor) ? atual : melhor,
  );
}

/**
 * Parada dupla do roadmap: SE(θ) abaixo do alvo OU teto de itens OU teto de
 * tempo. Os dois tetos existem para que nenhum respondente fique preso numa
 * aplicação que não converge -- padrão de resposta atípico pode nunca
 * atingir o SE alvo.
 */
export function deveParar(estado: EstadoParada, criterios: CriteriosParada): boolean {
  return (
    estado.se < criterios.seAlvo ||
    estado.itensAplicados >= criterios.tetoItens ||
    estado.segundosDecorridos >= criterios.tetoSegundos
  );
}

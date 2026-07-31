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
 * Informação total do bloco em θ -- a SOMA das informações de Fisher de
 * TODOS os itens que o compõem, não a do primeiro nem a média.
 *
 * A soma é o critério: um bloco de três itens moderados pode carregar mais
 * informação que um bloco de um item muito discriminativo, e é isso que o
 * CAT precisa enxergar para escolher bem. Coberto por
 * `__tests__/cat-engine.spec.ts` com um par de blocos em que a soma e o
 * primeiro item DISCORDAM -- sem esse par, trocar esta linha por
 * `itemParams[0]` passava despercebido pela suíte inteira.
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
 * (assessment_0006, com os caminhos de flanco fechados pela
 * assessment_0014). Selecionar por informação sobre parâmetros de
 * literatura escolheria itens errados e contaminaria a calibração futura.
 *
 * ---------------------------------------------------------------------------
 * LIMITE CONHECIDO -- RESOLVER ANTES DE LIGAR O CAT.
 *
 * O critério de seleção daqui e o modelo de escoragem de `mfc-scoring.ts`
 * não são o mesmo modelo:
 *
 *   - a ESCORAGEM estima um θ POR DIMENSÃO, por EAP sobre a verossimilhança
 *     par-a-par (Bradley-Terry-Luce), em que um item de chave negativa entra
 *     com -a (`aEfetivo`) e a probabilidade depende da DIFERENÇA das
 *     utilidades dos dois itens comparados;
 *
 *   - a SELEÇÃO daqui recebe UM θ escalar e ranqueia blocos pela soma das
 *     informações de Fisher DICOTÔMICAS de cada item isoladamente. Ela não
 *     sabe a que dimensão aquele θ pertence -- e um bloco MFC mistura
 *     domínios por construção -- e, como `a` entra ao quadrado, a valência do
 *     item é invisível para ela.
 *
 * A informação de fato relevante para um bloco MFC é a da COMPARAÇÃO
 * par-a-par, função da diferença das utilidades efetivas, não de cada item
 * sozinho. As duas peças estão corretas isoladamente; o que falta é coerência
 * entre elas.
 *
 * Sem impacto hoje: o CAT está travado no banco e nada fora dos testes
 * importa este módulo. Mas ligar o CAT é `UPDATE instrument_version SET
 * modo_administracao = 'cat'` -- um comando -- então este parágrafo é a única
 * coisa entre aquele comando e um critério de seleção incoerente com o
 * escore. Rever com os dados da calibração real em mãos.
 * ---------------------------------------------------------------------------
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

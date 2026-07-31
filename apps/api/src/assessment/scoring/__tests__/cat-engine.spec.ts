import { selecionarProximoBloco, deveParar, BlocoCandidato } from '../cat-engine';
import { ItemParams } from '../irt-primitives';

const p = (a: number, b: number): ItemParams => ({ a, b, c: 0 });

const blocos: BlocoCandidato[] = [
  { blockId: 'facil', itemParams: [p(1.2, -2.0), p(1.1, -1.8)], taxaExposicao: 0.1 },
  { blockId: 'medio', itemParams: [p(1.3, 0.0), p(1.2, 0.1)], taxaExposicao: 0.1 },
  { blockId: 'dificil', itemParams: [p(1.2, 2.0), p(1.1, 1.9)], taxaExposicao: 0.1 },
];

describe('motor CAT', () => {
  it('em theta médio, escolhe o bloco de dificuldade média (máxima informação)', () => {
    expect(selecionarProximoBloco(0, blocos, [])?.blockId).toBe('medio');
  });

  it('em theta alto, escolhe o bloco difícil', () => {
    expect(selecionarProximoBloco(2.0, blocos, [])?.blockId).toBe('dificil');
  });

  it('nunca repete bloco já aplicado', () => {
    const escolhido = selecionarProximoBloco(0, blocos, ['medio']);
    expect(escolhido?.blockId).not.toBe('medio');
    expect(escolhido).not.toBeNull();
  });

  it('respeita o teto de exposição de Sympson-Hetter', () => {
    const superExposto: BlocoCandidato[] = [
      { ...blocos[1], taxaExposicao: 0.99 },
      { ...blocos[0], taxaExposicao: 0.05 },
    ];
    // O bloco 'medio' é o mais informativo em theta 0, mas está estourando
    // o teto de exposição -- o motor deve preferir o outro.
    expect(selecionarProximoBloco(0, superExposto, [], { rMax: 0.3 })?.blockId).toBe('facil');
  });

  it('devolve null quando não há mais bloco elegível', () => {
    expect(selecionarProximoBloco(0, blocos, ['facil', 'medio', 'dificil'])).toBeNull();
  });

  it('para quando SE atinge o alvo', () => {
    expect(deveParar({ se: 0.28, itensAplicados: 10, segundosDecorridos: 100 },
      { seAlvo: 0.3, tetoItens: 60, tetoSegundos: 3600 })).toBe(true);
  });

  it('para no teto de itens mesmo com SE alto', () => {
    expect(deveParar({ se: 0.9, itensAplicados: 60, segundosDecorridos: 100 },
      { seAlvo: 0.3, tetoItens: 60, tetoSegundos: 3600 })).toBe(true);
  });

  it('para no teto de tempo mesmo com SE alto e poucos itens', () => {
    expect(deveParar({ se: 0.9, itensAplicados: 5, segundosDecorridos: 3600 },
      { seAlvo: 0.3, tetoItens: 60, tetoSegundos: 3600 })).toBe(true);
  });

  it('continua quando nenhum critério de parada foi atingido', () => {
    expect(deveParar({ se: 0.5, itensAplicados: 10, segundosDecorridos: 100 },
      { seAlvo: 0.3, tetoItens: 60, tetoSegundos: 3600 })).toBe(false);
  });

  /**
   * A agregação da informação dos itens em informação DO BLOCO é o critério
   * de seleção do CAT para um bloco MFC -- e os três blocos acima ranqueiam
   * IGUAL sob "soma de todos os itens" e sob "só o primeiro item", então
   * nenhum caso acima a discrimina. Confirmado por mutação: trocar a soma
   * por `informacaoFisher(theta, bloco.itemParams[0])` deixava os 9 casos
   * verdes.
   *
   * Os dois blocos abaixo são construídos para que as agregações DISCORDEM,
   * todos os itens em b = 0 e theta = 0 (onde P = Q = 0.5, logo
   * I = a² · 0.25 exatamente):
   *
   *   solo: 1 item, a = 1.7  ->  soma = média = primeiro = 0.7225
   *   trio: 3 itens, a = 1.0 ->  soma = 0.75 | média = primeiro = 0.25
   *
   * Sob a regra correta (soma) vence 'trio'. Sob "só o primeiro", sob "média"
   * e sob "esqueci um item do bloco" (0.5) vence 'solo'. Um só caso mata as
   * quatro degenerações.
   */
  const blocoSolo: BlocoCandidato = {
    blockId: 'solo',
    itemParams: [p(1.7, 0)],
    taxaExposicao: 0.1,
  };
  const blocoTrio: BlocoCandidato = {
    blockId: 'trio',
    itemParams: [p(1.0, 0), p(1.0, 0), p(1.0, 0)],
    taxaExposicao: 0.1,
  };

  it('agrega a informação do bloco somando TODOS os itens, não só o primeiro', () => {
    expect(selecionarProximoBloco(0, [blocoSolo, blocoTrio], [])?.blockId).toBe('trio');
  });

  it('não confunde soma com contagem de itens: um item forte o bastante vence três fracos', () => {
    // soloForte: 2.0² · 0.25 = 1.0 contra os mesmos 0.75 do trio. Sem este
    // caso, "escolha o bloco com mais itens" também passaria no caso acima.
    const soloForte: BlocoCandidato = { ...blocoSolo, blockId: 'soloForte', itemParams: [p(2.0, 0)] };
    expect(selecionarProximoBloco(0, [blocoTrio, soloForte], [])?.blockId).toBe('soloForte');
  });

  /**
   * Os dois casos abaixo fecham o único ramo do módulo que a suíte ainda não
   * prendia: o controle de exposição de Sympson-Hetter. Confirmado por
   * mutação -- com os 11 casos anteriores, tanto `rMax ?? 0` quanto
   * `taxaExposicao < rMax` ficavam VERDES.
   *
   * Todos os blocos daqui têm b = 0 e são avaliados em theta = 0, onde
   * P = Q = 0.5 e portanto I = a² · 0.25 exatamente: a = 2.0 dá 1.0 e
   * a = 1.0 dá 0.25. Assim a informação e a exposição apontam para blocos
   * DIFERENTES, que é o que torna o critério observável.
   */
  const forteEUsado: BlocoCandidato = {
    blockId: 'forteEUsado',
    itemParams: [p(2.0, 0)],
    taxaExposicao: 0.4,
  };
  const fracoENovo: BlocoCandidato = {
    blockId: 'fracoENovo',
    itemParams: [p(1.0, 0)],
    taxaExposicao: 0,
  };

  it('sem opções, NÃO impõe teto de exposição: quem não pede teto não ganha um', () => {
    // O default `rMax = 1` é uma decisão semântica -- "sem teto quando o
    // chamador não pede" -- e não uma constante qualquer. Com `?? 0` o motor
    // passaria a exigir exposição exatamente zero de toda chamada sem opções,
    // devolvendo 'fracoENovo' aqui e degradando a seleção em silêncio assim
    // que as exposições deixarem de ser todas nulas.
    expect(selecionarProximoBloco(0, [forteEUsado, fracoENovo], [])?.blockId).toBe('forteEUsado');
  });

  it('o teto de exposição é INCLUSIVO: bloco exatamente no teto continua elegível', () => {
    // r_max é um teto de exposição aceitável, não um limite a ser evitado por
    // uma margem. Com `<` no lugar de `<=`, o bloco que está exatamente na
    // cota permitida seria descartado e venceria 'fracoENovo'.
    const exatamenteNoTeto: BlocoCandidato = { ...forteEUsado, blockId: 'exatamenteNoTeto', taxaExposicao: 0.4 };
    expect(selecionarProximoBloco(0, [exatamenteNoTeto, fracoENovo], [], { rMax: 0.4 })?.blockId).toBe(
      'exatamenteNoTeto',
    );
  });
});

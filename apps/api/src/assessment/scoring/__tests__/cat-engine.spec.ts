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
});

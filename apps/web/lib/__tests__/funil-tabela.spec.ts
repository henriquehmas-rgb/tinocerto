import { describe, expect, it } from 'vitest';
import { achatarFunil, ordenarCandidaturas, paginar } from '../funil-tabela';

const AGORA = new Date('2026-08-30T12:00:00Z');

function candidatura(over: Partial<Parameters<typeof achatarFunil>[0][string][number]> = {}) {
  return {
    id: over.id ?? 'app-1',
    personId: 'p-1',
    nomeCandidato: over.nomeCandidato ?? 'Ana',
    criadoEm: over.criadoEm ?? '2026-08-30T08:00:00Z',
    assessmentStatus: over.assessmentStatus ?? null,
    origemCanal: over.origemCanal ?? null,
    scoreAderencia: over.scoreAderencia ?? null,
  };
}

describe('achatarFunil', () => {
  it('junta as etapas preservando a ordem interna de cada uma', () => {
    const funil = {
      triagem: [candidatura({ id: 'a1', nomeCandidato: 'Ana' }), candidatura({ id: 'a2', nomeCandidato: 'Bruno' })],
      entrevista: [candidatura({ id: 'a3', nomeCandidato: 'Carla' })],
    };
    const linhas = achatarFunil(funil);
    expect(linhas.map((l) => l.id)).toEqual(['a1', 'a2', 'a3']);
    expect(linhas[0].etapa).toBe('triagem');
    expect(linhas[2].etapa).toBe('entrevista');
  });

  it('funil vazio devolve lista vazia', () => {
    expect(achatarFunil({})).toEqual([]);
  });
});

describe('ordenarCandidaturas', () => {
  const ORDEM = ['triagem', 'entrevista', 'oferta'];

  it('com ordenacao null preserva a ordem recebida', () => {
    const linhas = [
      { ...candidatura({ id: 'a1' }), etapa: 'triagem' },
      { ...candidatura({ id: 'a2' }), etapa: 'entrevista' },
    ];
    expect(ordenarCandidaturas(linhas, null, AGORA, ORDEM).map((l) => l.id)).toEqual(['a1', 'a2']);
  });

  it('ordena por idade ascendente: mais recente (menos dias) primeiro', () => {
    const linhas = [
      { ...candidatura({ id: 'velho', criadoEm: '2026-08-20T08:00:00Z' }), etapa: 'triagem' },
      { ...candidatura({ id: 'novo', criadoEm: '2026-08-29T08:00:00Z' }), etapa: 'triagem' },
    ];
    const resultado = ordenarCandidaturas(linhas, { coluna: 'idade', direcao: 'asc' }, AGORA, ORDEM);
    expect(resultado.map((l) => l.id)).toEqual(['novo', 'velho']);
  });

  it('fit nulo vai sempre por último, em asc e em desc', () => {
    const linhas = [
      { ...candidatura({ id: 'com-fit', scoreAderencia: 40 }), etapa: 'triagem' },
      { ...candidatura({ id: 'sem-fit', scoreAderencia: null }), etapa: 'triagem' },
    ];
    const asc = ordenarCandidaturas(linhas, { coluna: 'fit', direcao: 'asc' }, AGORA, ORDEM);
    expect(asc.map((l) => l.id)).toEqual(['com-fit', 'sem-fit']);
    const desc = ordenarCandidaturas(linhas, { coluna: 'fit', direcao: 'desc' }, AGORA, ORDEM);
    expect(desc.map((l) => l.id)).toEqual(['com-fit', 'sem-fit']);
  });

  it('ordena por etapa usando a posicao na ordem conhecida', () => {
    const linhas = [
      { ...candidatura({ id: 'na-entrevista' }), etapa: 'entrevista' },
      { ...candidatura({ id: 'na-triagem' }), etapa: 'triagem' },
    ];
    const resultado = ordenarCandidaturas(linhas, { coluna: 'etapa', direcao: 'asc' }, AGORA, ORDEM);
    expect(resultado.map((l) => l.id)).toEqual(['na-triagem', 'na-entrevista']);
  });

  it('etapa fora da ordem conhecida ordena por nome, depois das conhecidas', () => {
    const linhas = [
      { ...candidatura({ id: 'desconhecida' }), etapa: 'zzz-nova' },
      { ...candidatura({ id: 'conhecida' }), etapa: 'triagem' },
    ];
    const resultado = ordenarCandidaturas(linhas, { coluna: 'etapa', direcao: 'asc' }, AGORA, ORDEM);
    expect(resultado.map((l) => l.id)).toEqual(['conhecida', 'desconhecida']);
  });

  it('ordena por nome alfabeticamente', () => {
    const linhas = [
      { ...candidatura({ id: 'b', nomeCandidato: 'Bruno' }), etapa: 'triagem' },
      { ...candidatura({ id: 'a', nomeCandidato: 'Ana' }), etapa: 'triagem' },
    ];
    const resultado = ordenarCandidaturas(linhas, { coluna: 'nome', direcao: 'asc' }, AGORA, ORDEM);
    expect(resultado.map((l) => l.id)).toEqual(['a', 'b']);
  });
});

describe('paginar', () => {
  it('devolve a pagina pedida e o total de paginas', () => {
    const itens = Array.from({ length: 25 }, (_, i) => i);
    const resultado = paginar(itens, 1, 10);
    expect(resultado.pagina).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(resultado.totalPaginas).toBe(3);
  });

  it('ultima pagina parcial devolve so os itens restantes', () => {
    const itens = Array.from({ length: 25 }, (_, i) => i);
    const resultado = paginar(itens, 3, 10);
    expect(resultado.pagina).toEqual([20, 21, 22, 23, 24]);
  });

  it('porPagina maior que o total devolve tudo numa pagina so', () => {
    const itens = [1, 2, 3];
    const resultado = paginar(itens, 1, 25);
    expect(resultado.pagina).toEqual([1, 2, 3]);
    expect(resultado.totalPaginas).toBe(1);
  });

  it('lista vazia devolve pagina vazia e 1 pagina total', () => {
    const resultado = paginar([], 1, 25);
    expect(resultado.pagina).toEqual([]);
    expect(resultado.totalPaginas).toBe(1);
  });
});

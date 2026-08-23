import { describe, expect, it } from 'vitest';
import { wordDiff } from '../word-diff';

describe('wordDiff', () => {
  it('marca palavras identicas como iguais', () => {
    const resultado = wordDiff('vaga de desenvolvedor', 'vaga de desenvolvedor');
    expect(resultado.every((p) => p.tipo === 'igual')).toBe(true);
  });

  it('marca palavra removida e adicionada quando um trecho muda', () => {
    const resultado = wordDiff('procuramos um rapaz esforçado', 'procuramos uma pessoa esforçada');
    expect(resultado.some((p) => p.tipo === 'removido' && p.texto === 'rapaz')).toBe(true);
    expect(resultado.some((p) => p.tipo === 'adicionado' && p.texto === 'pessoa')).toBe(true);
  });
});

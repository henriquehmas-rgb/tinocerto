import { describe, expect, it } from 'vitest';
import { montarGrupos } from '../painel-nav';

function acharItem(grupos: ReturnType<typeof montarGrupos>, label: string) {
  const item = grupos.flatMap((g) => g.itens).find((i) => i.label === label);
  if (!item) throw new Error(`item ${label} não encontrado`);
  return item;
}

describe('montarGrupos', () => {
  it('devolve os grupos Operação e Plataforma', () => {
    const grupos = montarGrupos('/staff/painel');
    expect(grupos.map((g) => g.rotulo)).toEqual(['Operação', 'Plataforma']);
  });

  it('acende Dashboard apenas no caminho exato', () => {
    // Regressão: '/staff/painel' é prefixo de todas as rotas do painel, então
    // casamento por prefixo acenderia Dashboard em qualquer tela.
    expect(acharItem(montarGrupos('/staff/painel'), 'Dashboard').ativo).toBe(true);
    expect(acharItem(montarGrupos('/staff/painel/vagas'), 'Dashboard').ativo).toBe(false);
    expect(acharItem(montarGrupos('/staff/painel/configuracoes'), 'Dashboard').ativo).toBe(false);
  });

  it('acende Vagas no caminho exato e nas rotas filhas', () => {
    expect(acharItem(montarGrupos('/staff/painel/vagas'), 'Vagas').ativo).toBe(true);
    expect(acharItem(montarGrupos('/staff/painel/vagas/abc-123'), 'Vagas').ativo).toBe(true);
    expect(acharItem(montarGrupos('/staff/painel/vagas/abc-123/editar'), 'Vagas').ativo).toBe(true);
    expect(acharItem(montarGrupos('/staff/painel'), 'Vagas').ativo).toBe(false);
    expect(acharItem(montarGrupos('/staff/painel/vagas-arquivadas'), 'Vagas').ativo).toBe(false);
  });

  it('acende Vagas também em candidaturas, que são alcançadas a partir de uma vaga', () => {
    expect(acharItem(montarGrupos('/staff/painel/candidaturas/xyz'), 'Vagas').ativo).toBe(true);
  });

  it('mostra o contador de vagas quando informado e o omite quando não', () => {
    expect(acharItem(montarGrupos('/staff/painel', { vagasAtivas: 4 }), 'Vagas').contador).toBe(4);
    expect(acharItem(montarGrupos('/staff/painel'), 'Vagas').contador).toBeUndefined();
    expect(acharItem(montarGrupos('/staff/painel', {}), 'Vagas').contador).toBeUndefined();
  });

  it('mostra contador zero quando há zero vagas ativas', () => {
    // 0 é um valor legítimo — não pode ser engolido por checagem de falsy.
    expect(acharItem(montarGrupos('/staff/painel', { vagasAtivas: 0 }), 'Vagas').contador).toBe(0);
  });
});

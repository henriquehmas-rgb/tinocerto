import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { lerVisaoPreferida, salvarVisaoPreferida } from '../funil-view-provider';

describe('funil-view-provider', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('sem preferencia salva, devolve kanban', () => {
    expect(lerVisaoPreferida()).toBe('kanban');
  });

  it('le a preferencia salva', () => {
    window.localStorage.setItem('tinocerto:funil-view', 'tabela');
    expect(lerVisaoPreferida()).toBe('tabela');
  });

  it('valor invalido no storage cai no padrao', () => {
    window.localStorage.setItem('tinocerto:funil-view', 'mapa-mental');
    expect(lerVisaoPreferida()).toBe('kanban');
  });

  it('localStorage lancando no read nao quebra, cai no padrao', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage bloqueado');
    });
    expect(lerVisaoPreferida()).toBe('kanban');
  });

  it('salva e depois le de volta', () => {
    salvarVisaoPreferida('tabela');
    expect(lerVisaoPreferida()).toBe('tabela');
  });

  it('localStorage lancando no write nao lanca pra fora', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage bloqueado');
    });
    expect(() => salvarVisaoPreferida('tabela')).not.toThrow();
  });
});

export type VisaoFunil = 'kanban' | 'tabela';

const CHAVE_STORAGE = 'tinocerto:funil-view';

export function lerVisaoPreferida(): VisaoFunil {
  try {
    const bruto = window.localStorage.getItem(CHAVE_STORAGE);
    if (bruto === 'kanban' || bruto === 'tabela') return bruto;
  } catch {
    // localStorage bloqueado (modo privado restrito) -- cai no padrão.
  }
  return 'kanban';
}

export function salvarVisaoPreferida(visao: VisaoFunil): void {
  try {
    window.localStorage.setItem(CHAVE_STORAGE, visao);
  } catch {
    // Sem persistência quando o storage está bloqueado; a visão da sessão
    // atual continua funcionando.
  }
}

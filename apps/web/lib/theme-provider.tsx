'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Tema } from '@tinocerto/design-system';

const CHAVE_STORAGE = 'tinocerto:theme';

export interface ContextoTema {
  tema: Tema;
  definirTema: (tema: Tema) => void;
}

const PADRAO: ContextoTema = { tema: 'auto', definirTema: () => {} };

const Contexto = createContext<ContextoTema | null>(null);

export function lerPreferencia(): Tema {
  try {
    const bruto = window.localStorage.getItem(CHAVE_STORAGE);
    if (bruto === 'light' || bruto === 'dark' || bruto === 'auto') return bruto;
  } catch {
    // localStorage bloqueado (modo privado restrito) — cai no padrão.
  }
  return 'auto';
}

export function resolverTema(tema: Tema): 'light' | 'dark' {
  if (tema !== 'auto') return tema;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Começa em 'auto' e só lê o storage depois da montagem: ler durante o
  // render inicial divergiria do HTML renderizado no servidor.
  const [tema, setTema] = useState<Tema>('auto');

  useEffect(() => {
    setTema(lerPreferencia());
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolverTema(tema);
    if (tema !== 'auto') return;

    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const aoMudar = () => {
      document.documentElement.dataset.theme = resolverTema('auto');
    };
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, [tema]);

  // Reset ao desmontar. O ThemeProvider só existe dentro de /staff/painel;
  // SCRIPT_TEMA (em app/layout.tsx) só estampa um tema resolvido nessa
  // mesma raiz e força 'light' em toda rota fora dela -- mas isso só roda
  // num carregamento de página cheio. Numa navegação client-side pra fora
  // do painel, nada mais reavalia data-theme, e sem este reset o atributo
  // 'dark' ficaria vazando pro <html> em rotas nunca revisadas nesse tema.
  useEffect(() => {
    return () => {
      document.documentElement.dataset.theme = 'light';
    };
  }, []);

  const definirTema = useCallback((novo: Tema) => {
    setTema(novo);
    try {
      window.localStorage.setItem(CHAVE_STORAGE, novo);
    } catch {
      // Sem persistência quando o storage está bloqueado; o tema da sessão
      // atual continua funcionando.
    }
  }, []);

  return <Contexto.Provider value={{ tema, definirTema }}>{children}</Contexto.Provider>;
}

// Devolve o padrão fora de um provider em vez de lançar: em produção o
// provider está no layout do painel, mas nos testes as páginas são
// renderizadas isoladamente, sem seus layouts.
export function useTema(): ContextoTema {
  return useContext(Contexto) ?? PADRAO;
}

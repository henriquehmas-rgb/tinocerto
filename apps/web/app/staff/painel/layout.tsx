import type { Metadata } from 'next';
import { ThemeProvider } from '../../../lib/theme-provider';

// O template precisa ser redeclarado aqui, e nao so na raiz: no App Router
// o sufixo aplicado a um segmento vem do title do ANCESTRAL mais proximo, e
// um title em string simples nao carrega template nenhum. Com apenas
// `title: 'Painel'` neste layout, os segmentos filhos (vagas,
// configuracoes) perdiam o sufixo e a aba mostrava so 'Vagas'.
export const metadata: Metadata = {
  title: { default: 'Painel', template: '%s · Tinocerto' },
};

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

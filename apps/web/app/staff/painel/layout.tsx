import type { Metadata } from 'next';
import { ThemeProvider } from '../../../lib/theme-provider';

export const metadata: Metadata = { title: 'Painel' };

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

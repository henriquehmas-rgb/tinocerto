import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Configurações' };

export default function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

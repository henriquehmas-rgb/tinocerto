import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Painel' };

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Vagas' };

export default function VagasLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

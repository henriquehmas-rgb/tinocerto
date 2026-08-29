import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Carreiras' };

export default function CarreirasLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

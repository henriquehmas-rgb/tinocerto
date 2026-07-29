import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tinocerto — Carreiras',
  description: 'Vagas abertas e candidatura',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-bg text-text font-ui">{children}</body>
    </html>
  );
}

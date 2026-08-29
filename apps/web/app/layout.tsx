import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-archivo',
  display: 'swap',
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Tinocerto', template: '%s · Tinocerto' },
  description: 'Plataforma de recrutamento e seleção',
};

// Resolve o tema ANTES da hidratação: sem isso, quem usa tema escuro vê um
// flash de tema claro entre a pintura do HTML e a montagem do ThemeProvider.
// `auto` é resolvido aqui em JS porque tokens.css define os semânticos
// escuros apenas sob [data-theme="dark"] -- ver lib/theme-provider.tsx.
const SCRIPT_TEMA = `
(function(){try{
var p=localStorage.getItem('tinocerto:theme');
if(p!=='light'&&p!=='dark'&&p!=='auto')p='auto';
var escuro=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.dataset.theme=p==='auto'?(escuro?'dark':'light'):p;
}catch(e){document.documentElement.dataset.theme='light';}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="bg-bg text-text font-ui">{children}</body>
    </html>
  );
}

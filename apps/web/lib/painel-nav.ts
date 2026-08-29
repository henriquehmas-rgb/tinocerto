import { LayoutDashboard, Briefcase, Settings } from 'lucide-react';
import type { PanelNavGrupo } from '@tinocerto/design-system';

export interface ContadoresNav {
  vagasAtivas?: number;
}

// Casamento por prefixo com barra: '/staff/painel/vagas' acende em
// '/staff/painel/vagas/abc' mas não em '/staff/painel/vagas-arquivadas'.
function cobre(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function montarGrupos(pathname: string, contadores?: ContadoresNav): PanelNavGrupo[] {
  // Vagas fica acesa em candidaturas: a tela de candidatura é sempre
  // alcançada a partir de uma vaga, e deixar a sidebar sem nenhum item
  // aceso ali faria o usuário perder a referência de onde está.
  const vagasAtivo =
    cobre('/staff/painel/vagas', pathname) || cobre('/staff/painel/candidaturas', pathname);

  return [
    {
      rotulo: 'Operação',
      itens: [
        {
          href: '/staff/painel',
          label: 'Dashboard',
          icone: LayoutDashboard,
          // Exato, não por prefixo: '/staff/painel' é prefixo de tudo.
          ativo: pathname === '/staff/painel',
        },
        {
          href: '/staff/painel/vagas',
          label: 'Vagas',
          icone: Briefcase,
          contador: contadores?.vagasAtivas,
          ativo: vagasAtivo,
        },
      ],
    },
    {
      rotulo: 'Plataforma',
      itens: [
        {
          href: '/staff/painel/configuracoes',
          label: 'Configurações',
          icone: Settings,
          ativo: cobre('/staff/painel/configuracoes', pathname),
        },
      ],
    },
  ];
}

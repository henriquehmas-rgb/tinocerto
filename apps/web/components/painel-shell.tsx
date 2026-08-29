'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PanelLayout, type BreadcrumbItem } from '@tinocerto/design-system';
import { montarGrupos, type ContadoresNav } from '../lib/painel-nav';
import { useTema } from '../lib/theme-provider';
import { staffPanelClient, PerfilStaff } from '../lib/staff-panel-client';
import { staffAuthClient, isErroDeAutenticacao } from '../lib/staff-auth-client';

export interface PainelShellProps {
  breadcrumb: BreadcrumbItem[];
  acao?: React.ReactNode;
  contadores?: ContadoresNav;
  children: React.ReactNode;
}

export function PainelShell({ breadcrumb, acao, contadores, children }: PainelShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { tema, definirTema } = useTema();
  const [perfil, setPerfil] = useState<PerfilStaff | null>(null);

  useEffect(() => {
    staffPanelClient
      .obterPerfil()
      .then(setPerfil)
      .catch((e: unknown) => {
        if (isErroDeAutenticacao(e)) router.push('/staff/entrar');
        // Falha não-autenticação: a casca segue renderizando com o cabeçalho
        // vazio. O erro relevante da página é tratado pela própria página, e
        // por isso não vira UI aqui -- mas é logado para deixar rastro, já
        // que sem isso o degrade da casca (cabeçalho vazio) não teria causa
        // visível em lugar nenhum.
        else console.error('Falha ao obter perfil do staff para a casca do painel:', e);
      });
  }, [router]);

  function handleSair() {
    staffAuthClient.logout();
    router.push('/staff/entrar');
  }

  return (
    <PanelLayout
      nomeStaff={perfil?.email ?? ''}
      nomeTenant={perfil?.razaoSocial ?? ''}
      grupos={montarGrupos(pathname ?? '', contadores)}
      breadcrumb={breadcrumb}
      acao={acao}
      tema={tema}
      onTemaChange={definirTema}
      onSair={handleSair}
      linkAs={Link}
    >
      {children}
    </PanelLayout>
  );
}

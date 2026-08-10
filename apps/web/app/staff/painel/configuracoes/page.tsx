'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Button, PanelLayout } from '@tinocerto/design-system';
import { staffPanelClient, ConexaoGoogleCalendar, PerfilStaff } from '../../../../lib/staff-panel-client';
import { staffAuthClient, isErroDeAutenticacao } from '../../../../lib/staff-auth-client';

const NAV_LINKS = [
  { href: '/staff/painel', label: 'Dashboard' },
  { href: '/staff/painel/vagas', label: 'Vagas' },
  { href: '/staff/painel/configuracoes', label: 'Configurações' },
];

export default function ConfiguracoesPage() {
  const router = useRouter();
  const [conexao, setConexao] = useState<ConexaoGoogleCalendar | null>(null);
  const [perfil, setPerfil] = useState<PerfilStaff | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function carregar() {
    staffPanelClient
      .obterConexaoGoogleCalendar()
      .then(setConexao)
      .catch((e) => {
        if (isErroDeAutenticacao(e)) {
          router.push('/staff/entrar');
          return;
        }
        setErro(e.message);
      });
  }

  useEffect(() => {
    carregar();
    staffPanelClient.obterPerfil().then(setPerfil).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleConectar() {
    const { url } = await staffPanelClient.obterUrlAutorizacaoGoogleCalendar();
    window.location.href = url;
  }

  async function handleDesconectar() {
    await staffPanelClient.desconectarGoogleCalendar();
    carregar();
  }

  function handleSair() {
    staffAuthClient.logout();
    router.push('/staff/entrar');
  }

  return (
    <PanelLayout nomeStaff={perfil?.email ?? ''} nomeTenant={perfil?.razaoSocial ?? ''} links={NAV_LINKS} onSair={handleSair}>
      <h1 className="font-display text-xl mb-4">Configurações</h1>
      {erro && <p className="text-danger-text">{erro}</p>}
      <Card>
        <p className="font-ui text-sm font-medium text-text mb-2">Google Calendar</p>
        {conexao?.connected ? (
          <div className="flex items-center justify-between gap-4">
            <p className="font-ui text-sm text-text-secondary">{conexao.googleEmail}</p>
            <Button variant="secondary" onClick={handleDesconectar}>
              Desconectar
            </Button>
          </div>
        ) : (
          <div>
            <p className="font-ui text-sm text-text-secondary mb-2">
              Conecte seu Google Calendar para organizar convites de entrevista automaticamente.
            </p>
            <Button onClick={handleConectar}>Conectar Google Calendar</Button>
          </div>
        )}
      </Card>
    </PanelLayout>
  );
}

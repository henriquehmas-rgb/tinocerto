'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Button } from '@tinocerto/design-system';
import { PainelShell } from '../../../../components/painel-shell';
import { staffPanelClient, ConexaoGoogleCalendar } from '../../../../lib/staff-panel-client';
import { isErroDeAutenticacao } from '../../../../lib/staff-auth-client';

export default function ConfiguracoesPage() {
  const router = useRouter();
  const [conexao, setConexao] = useState<ConexaoGoogleCalendar | null>(null);
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
  }, [router]);

  async function handleConectar() {
    const { url } = await staffPanelClient.obterUrlAutorizacaoGoogleCalendar();
    window.location.href = url;
  }

  async function handleDesconectar() {
    await staffPanelClient.desconectarGoogleCalendar();
    carregar();
  }

  return (
    <PainelShell breadcrumb={[{ label: 'Configurações' }]}>
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
    </PainelShell>
  );
}

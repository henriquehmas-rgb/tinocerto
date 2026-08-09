'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, Button, PanelLayout } from '@tinocerto/design-system';
import { staffPanelClient, DashboardMetricas, PerfilStaff } from '../../../lib/staff-panel-client';
import { staffAuthClient, isErroDeAutenticacao } from '../../../lib/staff-auth-client';

const NAV_LINKS = [
  { href: '/staff/painel', label: 'Dashboard' },
  { href: '/staff/painel/vagas', label: 'Vagas' },
];

export default function PainelPage() {
  const router = useRouter();
  const [metricas, setMetricas] = useState<DashboardMetricas | null>(null);
  const [perfil, setPerfil] = useState<PerfilStaff | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    function tratarFalha(e: unknown) {
      if (isErroDeAutenticacao(e)) {
        router.push('/staff/entrar');
        return;
      }
      setErro((e as Error).message);
    }
    staffPanelClient.obterMetricas().then(setMetricas).catch(tratarFalha);
    staffPanelClient.obterPerfil().then(setPerfil).catch(tratarFalha);
  }, [router]);

  function handleSair() {
    staffAuthClient.logout();
    router.push('/staff/entrar');
  }

  const semVagas = metricas !== null && metricas.vagasAtivas === 0 && metricas.vagasRascunho === 0;

  return (
    <PanelLayout nomeStaff={perfil?.email ?? ''} nomeTenant={perfil?.razaoSocial ?? ''} links={NAV_LINKS} onSair={handleSair}>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-xl">Dashboard</h1>
        <Link href="/staff/painel/vagas/nova">
          <Button>Nova vaga</Button>
        </Link>
      </div>
      {erro && <p className="text-danger-text">{erro}</p>}
      {semVagas && (
        <Card>
          <p className="font-ui text-sm text-text mb-2">Você ainda não tem nenhuma vaga cadastrada.</p>
          <Link href="/staff/painel/vagas/nova">
            <Button>Criar sua primeira vaga</Button>
          </Link>
        </Card>
      )}
      {metricas && !semVagas && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card>
            <p className="font-ui text-xs text-text-secondary">Vagas ativas</p>
            <p className="font-display text-2xl text-text">{metricas.vagasAtivas}</p>
          </Card>
          <Card>
            <p className="font-ui text-xs text-text-secondary">Rascunhos</p>
            <p className="font-display text-2xl text-text">{metricas.vagasRascunho}</p>
          </Card>
          <Card>
            <p className="font-ui text-xs text-text-secondary">Candidaturas em andamento</p>
            <p className="font-display text-2xl text-text">{metricas.candidaturasEmAndamento}</p>
          </Card>
          <Card>
            <p className="font-ui text-xs text-text-secondary mb-1">Por estágio</p>
            {Object.entries(metricas.porEstagio).map(([estagio, total]) => (
              <p key={estagio} className="font-ui text-sm text-text">
                {estagio}: {total}
              </p>
            ))}
          </Card>
        </div>
      )}
    </PanelLayout>
  );
}

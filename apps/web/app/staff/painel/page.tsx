'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, Button, EmptyState } from '@tinocerto/design-system';
import { Briefcase } from 'lucide-react';
import { PainelShell } from '../../../components/painel-shell';
import { staffPanelClient, DashboardMetricas } from '../../../lib/staff-panel-client';
import { isErroDeAutenticacao } from '../../../lib/staff-auth-client';

export default function PainelPage() {
  const router = useRouter();
  const [metricas, setMetricas] = useState<DashboardMetricas | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    staffPanelClient
      .obterMetricas()
      .then(setMetricas)
      .catch((e: unknown) => {
        if (isErroDeAutenticacao(e)) {
          router.push('/staff/entrar');
          return;
        }
        setErro((e as Error).message);
      });
  }, [router]);

  const semVagas = metricas !== null && metricas.vagasAtivas === 0 && metricas.vagasRascunho === 0;

  return (
    <PainelShell
      breadcrumb={[{ label: 'Dashboard' }]}
      contadores={{ vagasAtivas: metricas?.vagasAtivas }}
      acao={
        <Link href="/staff/painel/vagas/nova">
          <Button>Nova vaga</Button>
        </Link>
      }
    >
      {erro && <p className="text-danger-text">{erro}</p>}
      {semVagas && (
        <EmptyState
          icone={Briefcase}
          titulo="Nenhuma vaga ainda"
          descricao="Crie sua primeira vaga para começar a receber candidaturas."
          acao={
            <Link href="/staff/painel/vagas/nova">
              <Button>Criar sua primeira vaga</Button>
            </Link>
          }
        />
      )}
      {metricas && !semVagas && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card>
            <p className="font-ui text-xs text-text-secondary">Vagas ativas</p>
            <p className="font-num text-2xl tabular-nums text-text">{metricas.vagasAtivas}</p>
          </Card>
          <Card>
            <p className="font-ui text-xs text-text-secondary">Rascunhos</p>
            <p className="font-num text-2xl tabular-nums text-text">{metricas.vagasRascunho}</p>
          </Card>
          <Card>
            <p className="font-ui text-xs text-text-secondary">Candidaturas em andamento</p>
            <p className="font-num text-2xl tabular-nums text-text">{metricas.candidaturasEmAndamento}</p>
          </Card>
          <Card>
            <p className="mb-1 font-ui text-xs text-text-secondary">Por estágio</p>
            {Object.entries(metricas.porEstagio).map(([estagio, total]) => (
              <p key={estagio} className="font-ui text-sm text-text">
                {estagio}: {total}
              </p>
            ))}
          </Card>
        </div>
      )}
    </PainelShell>
  );
}

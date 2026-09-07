'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, Button, EmptyState, EtapaBarra, Sparkline } from '@tinocerto/design-system';
import { Briefcase } from 'lucide-react';
import { PainelShell } from '../../../components/painel-shell';
import {
  staffPanelClient,
  DashboardMetricas,
  TendenciaCandidaturasDia,
} from '../../../lib/staff-panel-client';
import { isErroDeAutenticacao } from '../../../lib/staff-auth-client';

const ROTULO_ETAPA: Record<string, string> = { triagem: 'Triagem', entrevista: 'Entrevista' };
const ORDEM_ETAPAS_DASHBOARD = ['triagem', 'entrevista'];

export default function PainelPage() {
  const router = useRouter();
  const [metricas, setMetricas] = useState<DashboardMetricas | null>(null);
  const [tendencia, setTendencia] = useState<TendenciaCandidaturasDia[]>([]);
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

  useEffect(() => {
    // Falha na tendência não deve derrubar o resto do dashboard -- os
    // outros cards continuam de pé com o que já carregou. `.catch` sem
    // setar erro é intencional aqui: a sparkline simplesmente fica vazia.
    staffPanelClient.obterTendenciaCandidaturas(30).then(setTendencia).catch(() => {});
  }, []);

  const semVagas = metricas !== null && metricas.vagasAtivas === 0 && metricas.vagasRascunho === 0;

  const itensPorEstagio = metricas
    ? ORDEM_ETAPAS_DASHBOARD.filter((etapa) => etapa in metricas.porEstagio)
        .concat(Object.keys(metricas.porEstagio).filter((etapa) => !ORDEM_ETAPAS_DASHBOARD.includes(etapa)))
        .map((etapa) => ({
          etapa,
          rotulo: ROTULO_ETAPA[etapa] ?? etapa,
          total: metricas.porEstagio[etapa],
          conversao: null,
        }))
    : [];

  const totalNovasCandidaturas = tendencia.reduce((soma, dia) => soma + dia.total, 0);

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
        <>
          <div className="grid grid-cols-3 gap-4">
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
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <p className="mb-2 font-ui text-xs text-text-secondary">Por estágio</p>
              <EtapaBarra itens={itensPorEstagio} />
            </Card>
            <Card>
              <p className="font-ui text-xs text-text-secondary">Novas candidaturas (30 dias)</p>
              <p className="font-num text-2xl tabular-nums text-text">{totalNovasCandidaturas}</p>
              <div className="mt-2">
                <Sparkline pontos={tendencia} largura={280} altura={40} />
              </div>
            </Card>
          </div>
        </>
      )}
    </PainelShell>
  );
}

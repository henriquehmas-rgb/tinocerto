'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, EmptyState, EtapaBarra } from '@tinocerto/design-system';
import { TrendingUp } from 'lucide-react';
import { PainelShell } from '../../../../../components/painel-shell';
import { staffPanelClient, EtapaFunilAgregado, JanelaFunilAgregado } from '../../../../../lib/staff-panel-client';
import { isErroDeAutenticacao } from '../../../../../lib/staff-auth-client';

const ROTULO_ETAPA: Record<string, string> = { triagem: 'Triagem', entrevista: 'Entrevista' };

const JANELAS: { valor: JanelaFunilAgregado; rotulo: string }[] = [
  { valor: '30d', rotulo: '30 dias' },
  { valor: '90d', rotulo: '90 dias' },
  { valor: 'tudo', rotulo: 'Tudo' },
];

export default function FunilAgregadoPage() {
  const router = useRouter();
  const [janela, setJanela] = useState<JanelaFunilAgregado>('30d');
  const [funil, setFunil] = useState<EtapaFunilAgregado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setFunil(null);
    staffPanelClient
      .obterFunilConsolidado(janela)
      .then(setFunil)
      .catch((e: unknown) => {
        if (isErroDeAutenticacao(e)) {
          router.push('/staff/entrar');
          return;
        }
        setErro((e as Error).message);
      });
  }, [janela, router]);

  const semCandidaturas = funil !== null && funil.every((item) => item.total === 0);

  const itens = (funil ?? []).map((item) => ({
    etapa: item.etapa,
    rotulo: ROTULO_ETAPA[item.etapa] ?? item.etapa,
    total: item.total,
    conversao: item.conversao,
  }));

  return (
    <PainelShell breadcrumb={[{ label: 'Análise' }, { label: 'Funil agregado' }]}>
      {erro && <p className="text-danger-text">{erro}</p>}

      <div className="mb-4 flex gap-2">
        {JANELAS.map((opcao) => (
          <button
            key={opcao.valor}
            type="button"
            onClick={() => setJanela(opcao.valor)}
            className="pr-focusable rounded-control border border-border px-3 py-1.5 font-ui text-[13px]"
            style={
              janela === opcao.valor
                ? { background: 'var(--pr-selected)', color: 'var(--pr-text)' }
                : { color: 'var(--pr-text-secondary)' }
            }
          >
            {opcao.rotulo}
          </button>
        ))}
      </div>

      {semCandidaturas && (
        <EmptyState
          icone={TrendingUp}
          titulo="Nenhuma candidatura no período selecionado"
          descricao="Tente um período maior ou aguarde novas candidaturas chegarem."
        />
      )}

      {funil && !semCandidaturas && (
        <Card>
          <EtapaBarra itens={itens} />
        </Card>
      )}
    </PainelShell>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Table, Button, Badge, EmptyState, type TableColumn } from '@tinocerto/design-system';
import { Briefcase } from 'lucide-react';
import { PainelShell } from '../../../../components/painel-shell';
import { staffPanelClient, VagaResumo } from '../../../../lib/staff-panel-client';
import { isErroDeAutenticacao } from '../../../../lib/staff-auth-client';
import { idadeRelativa } from '../../../../lib/funil-formatacao';

export default function VagasPage() {
  const router = useRouter();
  const [vagas, setVagas] = useState<VagaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    function tratarFalha(e: unknown) {
      if (isErroDeAutenticacao(e)) {
        router.push('/staff/entrar');
        return;
      }
      setErro((e as Error).message);
    }
    staffPanelClient
      .listarVagas()
      .then(setVagas)
      .catch(tratarFalha)
      .finally(() => setCarregando(false));
  }, [router]);

  const colunas: TableColumn<VagaResumo>[] = [
    {
      header: 'Título',
      render: (vaga) => (
        <Link href={`/staff/painel/vagas/${vaga.id}`} className="font-ui text-sm font-medium text-text">
          {vaga.titulo}
        </Link>
      ),
    },
    {
      header: 'Status',
      render: (vaga) => (vaga.publicadoEm ? <Badge tone="sucesso">Publicada</Badge> : <Badge tone="neutro">Rascunho</Badge>),
    },
    {
      header: 'Candidaturas',
      render: (vaga) => `${vaga.contagemCandidaturas} candidatura(s)`,
    },
    {
      header: 'Criada em',
      render: (vaga) => idadeRelativa(vaga.criadoEm, new Date()),
    },
  ];

  return (
    <PainelShell
      breadcrumb={[{ label: 'Vagas' }]}
      acao={
        <Link href="/staff/painel/vagas/nova">
          <Button>Nova vaga</Button>
        </Link>
      }
    >
      {erro && <p className="text-danger-text">{erro}</p>}
      {!carregando && vagas.length === 0 && (
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
      {vagas.length > 0 && <Table columns={colunas} rows={vagas} />}
    </PainelShell>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Table, Button, PanelLayout } from '@tinocerto/design-system';
import { staffPanelClient, VagaResumo } from '../../../lib/staff-panel-client';
import { staffAuthClient, isErroDeAutenticacao } from '../../../lib/staff-auth-client';

export default function PainelPage() {
  const router = useRouter();
  const [vagas, setVagas] = useState<VagaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    staffPanelClient
      .listarVagas()
      .then(setVagas)
      .catch((e) => {
        if (isErroDeAutenticacao(e)) {
          router.push('/staff/entrar');
          return;
        }
        setErro(e.message);
      })
      .finally(() => setCarregando(false));
  }, [router]);

  function handleSair() {
    staffAuthClient.logout();
    router.push('/staff/entrar');
  }

  return (
    <PanelLayout nomeStaff="" nomeTenant="" onSair={handleSair}>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-xl">Vagas</h1>
        <Link href="/staff/painel/vagas/nova">
          <Button>Nova vaga</Button>
        </Link>
      </div>
      {erro && <p className="text-danger-text">{erro}</p>}
      {!carregando && (
        <Table
          columns={[
            { header: 'Título', render: (vaga: VagaResumo) => <Link href={`/staff/painel/vagas/${vaga.id}`}>{vaga.titulo}</Link> },
            { header: 'Status', render: (vaga: VagaResumo) => (vaga.publicadoEm ? 'Publicada' : 'Rascunho') },
          ]}
          rows={vagas}
        />
      )}
    </PanelLayout>
  );
}

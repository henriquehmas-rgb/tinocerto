'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, Button, Badge, PanelLayout } from '@tinocerto/design-system';
import { staffPanelClient, VagaResumo, PerfilStaff } from '../../../../lib/staff-panel-client';
import { staffAuthClient, isErroDeAutenticacao } from '../../../../lib/staff-auth-client';

const NAV_LINKS = [
  { href: '/staff/painel', label: 'Dashboard' },
  { href: '/staff/painel/vagas', label: 'Vagas' },
];

export default function VagasPage() {
  const router = useRouter();
  const [vagas, setVagas] = useState<VagaResumo[]>([]);
  const [perfil, setPerfil] = useState<PerfilStaff | null>(null);
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
    staffPanelClient.obterPerfil().then(setPerfil).catch(tratarFalha);
  }, [router]);

  function handleSair() {
    staffAuthClient.logout();
    router.push('/staff/entrar');
  }

  return (
    <PanelLayout nomeStaff={perfil?.email ?? ''} nomeTenant={perfil?.razaoSocial ?? ''} links={NAV_LINKS} onSair={handleSair}>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-xl">Vagas</h1>
        <Link href="/staff/painel/vagas/nova">
          <Button>Nova vaga</Button>
        </Link>
      </div>
      {erro && <p className="text-danger-text">{erro}</p>}
      {!carregando && vagas.length === 0 && (
        <Card>
          <p className="font-ui text-sm text-text mb-2">Você ainda não tem nenhuma vaga cadastrada.</p>
          <Link href="/staff/painel/vagas/nova">
            <Button>Criar sua primeira vaga</Button>
          </Link>
        </Card>
      )}
      <div className="flex flex-col gap-2">
        {vagas.map((vaga) => (
          <Card key={vaga.id}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <Link href={`/staff/painel/vagas/${vaga.id}`} className="font-ui text-sm font-medium text-text">
                  {vaga.titulo}
                </Link>
                <p className="font-ui text-xs text-text-secondary">{vaga.contagemCandidaturas} candidatura(s)</p>
              </div>
              {vaga.publicadoEm ? <Badge tone="sucesso">Publicada</Badge> : <Badge tone="neutro">Rascunho</Badge>}
            </div>
          </Card>
        ))}
      </div>
    </PanelLayout>
  );
}

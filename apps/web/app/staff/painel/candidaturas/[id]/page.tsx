'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, ScoreChart, PanelLayout } from '@tinocerto/design-system';
import { staffPanelClient, RelatorioAssessment, CandidaturaDetalhe, PerfilStaff } from '../../../../../lib/staff-panel-client';
import { staffAuthClient, isErroDeAutenticacao } from '../../../../../lib/staff-auth-client';

const NAV_LINKS = [
  { href: '/staff/painel', label: 'Dashboard' },
  { href: '/staff/painel/vagas', label: 'Vagas' },
];

export default function CandidaturaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [dados, setDados] = useState<RelatorioAssessment | null>(null);
  const [candidatura, setCandidatura] = useState<CandidaturaDetalhe | null>(null);
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
    staffPanelClient.obterRelatorioAssessment(params.id).then(setDados).catch(tratarFalha);
    staffPanelClient.obterCandidatura(params.id).then(setCandidatura).catch(tratarFalha);
    staffPanelClient.obterPerfil().then(setPerfil).catch(() => {});
  }, [params.id, router]);

  function handleSair() {
    staffAuthClient.logout();
    router.push('/staff/entrar');
  }

  const aderencia = dados?.aderencia ?? null;

  return (
    <PanelLayout nomeStaff={perfil?.email ?? ''} nomeTenant={perfil?.razaoSocial ?? ''} links={NAV_LINKS} onSair={handleSair}>
      <div className="max-w-2xl">
        <h1 className="font-display text-xl mb-4">Candidatura</h1>
        {erro && <p className="text-danger-text">{erro}</p>}
        <Card>
          {candidatura && (
            <div className="mb-4">
              <p className="font-display text-lg">{candidatura.person.nome}</p>
              <p className="font-ui text-sm text-text-secondary">Etapa atual: {candidatura.etapaFunil}</p>
            </div>
          )}
          {dados && (
            <ScoreChart
              scoreGeral={aderencia?.scoreAderencia != null ? aderencia.scoreAderencia / 100 : null}
              dimensoes={dados.relatorio?.secoes ?? []}
            />
          )}
          {aderencia && (aderencia.skillsBatidas.length > 0 || aderencia.skillsFaltantes.length > 0) && (
            <div className="mt-4 flex flex-col gap-2">
              <div>
                <p className="font-ui text-sm font-medium text-text">Skills atendidas</p>
                <p className="font-ui text-sm text-text-secondary">
                  {aderencia.skillsBatidas.length > 0 ? aderencia.skillsBatidas.join(', ') : 'Nenhuma'}
                </p>
              </div>
              <div>
                <p className="font-ui text-sm font-medium text-text">Skills faltantes</p>
                <p className="font-ui text-sm text-text-secondary">
                  {aderencia.skillsFaltantes.length > 0 ? aderencia.skillsFaltantes.join(', ') : 'Nenhuma'}
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </PanelLayout>
  );
}

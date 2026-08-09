'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ScoreChart } from '@tinocerto/design-system';
import { staffPanelClient, RelatorioAssessment, CandidaturaDetalhe } from '../../../../../lib/staff-panel-client';

export default function CandidaturaPage() {
  const params = useParams<{ id: string }>();
  const [dados, setDados] = useState<RelatorioAssessment | null>(null);
  const [candidatura, setCandidatura] = useState<CandidaturaDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    staffPanelClient
      .obterRelatorioAssessment(params.id)
      .then(setDados)
      .catch((e) => setErro(e.message));
    staffPanelClient
      .obterCandidatura(params.id)
      .then(setCandidatura)
      .catch((e) => setErro(e.message));
  }, [params.id]);

  const aderencia = dados?.aderencia ?? null;

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="font-display text-xl mb-4">Candidatura</h1>
      {erro && <p className="text-danger-text">{erro}</p>}
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
    </div>
  );
}

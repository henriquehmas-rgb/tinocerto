'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ScoreChart } from '@tinocerto/design-system';
import { staffPanelClient, RelatorioAssessment } from '../../../../../lib/staff-panel-client';

export default function CandidaturaPage() {
  const params = useParams<{ id: string }>();
  const [dados, setDados] = useState<RelatorioAssessment | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    staffPanelClient
      .obterRelatorioAssessment(params.id)
      .then(setDados)
      .catch((e) => setErro(e.message));
  }, [params.id]);

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="font-display text-xl mb-4">Candidatura</h1>
      {erro && <p className="text-danger">{erro}</p>}
      {dados && (
        <ScoreChart
          scoreGeral={dados.aderencia?.scoreAderencia != null ? dados.aderencia.scoreAderencia / 100 : null}
          dimensoes={dados.relatorio?.secoes ?? []}
        />
      )}
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { KanbanBoard } from '@tinocerto/design-system';
import { staffPanelClient, CandidaturaResumo } from '../../../../../lib/staff-panel-client';

const COLUNAS = [
  { chave: 'triagem', titulo: 'Triagem' },
  { chave: 'entrevista', titulo: 'Entrevista' },
];

export default function FunilPage() {
  const params = useParams<{ id: string }>();
  const [funil, setFunil] = useState<Record<string, CandidaturaResumo[]>>({});
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    staffPanelClient
      .obterFunil(params.id)
      .then(setFunil)
      .catch((e) => setErro(e.message));
  }, [params.id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function handleMover(candidatura: CandidaturaResumo, novaColuna: string) {
    await staffPanelClient.moverEtapa(candidatura.id, novaColuna);
    carregar();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-xl">Funil</h1>
        <Link href={`/staff/painel/vagas/${params.id}/editar`} className="font-ui text-sm text-accent underline">
          Editar vaga
        </Link>
      </div>
      {erro && <p className="text-danger">{erro}</p>}
      <KanbanBoard
        colunas={COLUNAS}
        itens={funil}
        renderItem={(item: CandidaturaResumo) => (
          <Link href={`/staff/painel/candidaturas/${item.id}`}>{item.nomeCandidato}</Link>
        )}
        labelMover={(item: CandidaturaResumo) => `Mover ${item.nomeCandidato}`}
        onMoverItem={handleMover}
      />
    </div>
  );
}

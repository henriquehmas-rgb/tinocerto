'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { candidateAuthClient } from '../../../../lib/candidate-auth-client';

interface EtapaPercorrida {
  deEtapa: string | null;
  paraEtapa: string;
  em: string;
}

interface DecisaoView {
  tipo: 'aprovacao' | 'reprovacao' | 'oferta';
  motivoCodigo: string | null;
  decididoEm: string;
  revisaoSolicitada: boolean;
  revisaoSolicitadaEm: string | null;
  podeSolicitarRevisao: boolean;
}

interface OfertaView {
  status: 'estendida' | 'aceita' | 'recusada';
  valor: string;
  moeda: string;
  estendidoEm: string;
  respondidoEm: string | null;
}

interface CandidateEvaluationView {
  applicationId: string;
  etapasPercorridas: EtapaPercorrida[];
  decisao: DecisaoView | null;
  oferta: OfertaView | null;
}

function formatarValor(valor: string, moeda: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda }).format(Number(valor));
}

export default function CandidaturaDetalhePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [view, setView] = useState<CandidateEvaluationView | null>(null);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [solicitando, setSolicitando] = useState(false);

  useEffect(() => {
    if (!candidateAuthClient.isLoggedIn()) {
      router.replace('/candidato/entrar');
      return;
    }
    carregar();
  }, []);

  async function carregar() {
    try {
      const response = await candidateAuthClient.authenticatedFetch(`/v1/candidate/applications/${params.id}/avaliacao`);
      if (response.status === 404) {
        setNaoEncontrada(true);
        return;
      }
      if (!response.ok) throw new Error('Não foi possível carregar a candidatura');
      setView(await response.json());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar a candidatura');
    }
  }

  async function handleSolicitarRevisao() {
    setSolicitando(true);
    try {
      const response = await candidateAuthClient.authenticatedFetch(
        `/v1/candidate/applications/${params.id}/actions/solicitar-revisao`,
        { method: 'POST' },
      );
      if (!response.ok && response.status !== 409) {
        throw new Error('Não foi possível solicitar a revisão');
      }
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao solicitar revisão');
    } finally {
      setSolicitando(false);
    }
  }

  if (naoEncontrada) {
    return (
      <main className="max-w-2xl mx-auto p-8">
        <p className="text-text-secondary">Candidatura não encontrada.</p>
      </main>
    );
  }

  if (erro) return <main className="max-w-2xl mx-auto p-8">{erro}</main>;
  if (!view) return <main className="max-w-2xl mx-auto p-8">Carregando...</main>;

  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="font-display text-2xl mb-6">Sua candidatura</h1>

      <div className="border border-border rounded-card p-4 bg-surface mb-4">
        <p className="font-ui font-medium mb-2">Linha do tempo</p>
        <ul className="flex flex-col gap-1">
          {view.etapasPercorridas.map((etapa, i) => (
            <li key={i} className="text-sm text-text-secondary">
              {etapa.deEtapa ?? 'início'} → <span>{etapa.paraEtapa}</span> (
              {new Date(etapa.em).toLocaleDateString('pt-BR')})
            </li>
          ))}
        </ul>
      </div>

      {view.decisao && (
        <div className="border border-border rounded-card p-4 bg-surface mb-4">
          <p className="font-ui font-medium mb-2">Decisão</p>
          <p className="text-sm text-text-secondary">{view.decisao.tipo}</p>
          {view.decisao.motivoCodigo && (
            <p className="text-sm text-text-secondary">
              Motivo: <span>{view.decisao.motivoCodigo}</span>
            </p>
          )}
          {view.decisao.tipo === 'reprovacao' && view.decisao.revisaoSolicitada && (
            <p className="text-sm text-text-secondary mt-2">
              Revisão solicitada em {new Date(view.decisao.revisaoSolicitadaEm!).toLocaleDateString('pt-BR')} — um
              recrutador vai reavaliar.
            </p>
          )}
          {view.decisao.tipo === 'reprovacao' && view.decisao.podeSolicitarRevisao && (
            <button
              type="button"
              onClick={handleSolicitarRevisao}
              disabled={solicitando}
              className="mt-2 rounded-control px-4 py-2 bg-accent text-on-accent font-ui text-sm font-medium"
            >
              Solicitar revisão
            </button>
          )}
        </div>
      )}

      {view.oferta && (
        <div className="border border-border rounded-card p-4 bg-surface">
          <p className="font-ui font-medium mb-2">Oferta</p>
          <p className="text-sm text-text-secondary">{formatarValor(view.oferta.valor, view.oferta.moeda)}</p>
          <p className="text-sm text-text-secondary">{view.oferta.status}</p>
        </div>
      )}
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { candidateAuthClient } from '../../../../../lib/candidate-auth-client';

interface ItemBloco {
  itemId: string;
  texto: string;
}

interface BlocoAtual {
  concluido?: false;
  blockId: string;
  itens: ItemBloco[];
  progresso: { atual: number; total: number };
}

interface Concluido {
  concluido: true;
}

type EstadoAssessment = BlocoAtual | Concluido;

export default function AssessmentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoAssessment | null>(null);
  const [maisId, setMaisId] = useState<string | null>(null);
  const [menosId, setMenosId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!candidateAuthClient.isLoggedIn()) {
      router.replace('/candidato/entrar');
      return;
    }
    carregarBlocoAtual();
  }, []);

  async function carregarBlocoAtual() {
    try {
      const response = await candidateAuthClient.authenticatedFetch(
        `/v1/candidate/applications/${params.id}/assessment`,
      );
      if (!response.ok) throw new Error('Não foi possível carregar o assessment');
      const body: EstadoAssessment = await response.json();
      setEstado(body);
      setMaisId(null);
      setMenosId(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar o assessment');
    }
  }

  async function handleProximo() {
    if (estado?.concluido || !maisId || !menosId) return;
    const blocoAtual = estado as BlocoAtual;
    setEnviando(true);
    setErro(null);
    try {
      const response = await candidateAuthClient.authenticatedFetch(
        `/v1/candidate/applications/${params.id}/assessment/blocks/${blocoAtual.blockId}/answer`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemIds: blocoAtual.itens.map((i) => i.itemId),
            maisId,
            menosId,
          }),
        },
      );
      if (!response.ok) throw new Error('Não foi possível enviar a resposta');
      const resultado: { concluido: boolean } = await response.json();
      if (resultado.concluido) {
        setEstado({ concluido: true });
      } else {
        await carregarBlocoAtual();
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar a resposta');
    } finally {
      setEnviando(false);
    }
  }

  if (erro) {
    return (
      <main className="pr-assessment min-h-screen flex items-center justify-center p-8">
        <p className="text-danger-text">{erro}</p>
      </main>
    );
  }

  if (!estado) {
    return (
      <main className="pr-assessment min-h-screen flex items-center justify-center p-8">
        <p className="font-ui text-sm text-text-secondary">Carregando...</p>
      </main>
    );
  }

  if (estado.concluido) {
    return (
      <main className="pr-assessment min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <p className="font-display text-xl text-text">Obrigado, sua resposta foi registrada.</p>
        <a href="/candidato/candidaturas" className="font-ui text-sm text-accent">
          Voltar para minhas candidaturas
        </a>
      </main>
    );
  }

  const [item1, item2] = estado.itens;
  const completo = maisId !== null && menosId !== null;

  return (
    <main className="pr-assessment min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <p className="font-ui text-sm text-text-secondary">
        Bloco {estado.progresso.atual + 1} de {estado.progresso.total}
      </p>
      <div className="max-w-md w-full flex flex-col gap-4">
        {[item1, item2].map((item) => (
          <fieldset key={item.itemId} className="flex flex-col gap-2 border border-border rounded-card p-4 bg-surface">
            <legend className="font-ui text-sm text-text px-1">{item.texto}</legend>
            <label className="flex items-center gap-2 font-ui text-sm text-text-secondary">
              <input
                type="radio"
                name="mais"
                aria-label={`${item.texto} — Mais parecido comigo`}
                checked={maisId === item.itemId}
                onChange={() => setMaisId(item.itemId)}
              />
              Mais parecido comigo
            </label>
            <label className="flex items-center gap-2 font-ui text-sm text-text-secondary">
              <input
                type="radio"
                name="menos"
                aria-label={`${item.texto} — Menos parecido comigo`}
                checked={menosId === item.itemId}
                onChange={() => setMenosId(item.itemId)}
              />
              Menos parecido comigo
            </label>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        onClick={handleProximo}
        disabled={!completo || enviando || maisId === menosId}
        className="rounded-control px-4 py-2 bg-accent text-on-accent font-ui text-sm font-medium disabled:opacity-50"
      >
        Próximo
      </button>
    </main>
  );
}

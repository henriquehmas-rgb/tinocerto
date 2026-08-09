'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { KanbanBoard, PanelLayout } from '@tinocerto/design-system';
import { staffPanelClient, CandidaturaResumo } from '../../../../../lib/staff-panel-client';
import { staffAuthClient, isErroDeAutenticacao } from '../../../../../lib/staff-auth-client';

// Colunas usadas apenas enquanto o funil ainda nao carregou, para evitar
// uma tela vazia por um instante. Assim que o funil chega, as colunas
// passam a ser derivadas de Object.keys(funil) (ver COLUNAS abaixo) --
// nunca ficam presas a 'triagem'/'entrevista', entao candidaturas em
// qualquer outra etapa (ex.: 'oferta') tambem aparecem.
const COLUNAS_PADRAO = [
  { chave: 'triagem', titulo: 'Triagem' },
  { chave: 'entrevista', titulo: 'Entrevista' },
];

function capitalizar(texto: string): string {
  if (!texto) return texto;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export default function FunilPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [funil, setFunil] = useState<Record<string, CandidaturaResumo[]>>({});
  const [funilCarregado, setFunilCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    staffPanelClient
      .obterFunil(params.id)
      .then((dados) => {
        setFunil(dados);
        setFunilCarregado(true);
      })
      .catch((e) => {
        if (isErroDeAutenticacao(e)) {
          router.push('/staff/entrar');
          return;
        }
        setErro(e.message);
      });
  }, [params.id, router]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function handleMover(candidatura: CandidaturaResumo, novaColuna: string) {
    await staffPanelClient.moverEtapa(candidatura.id, novaColuna);
    carregar();
  }

  function handleSair() {
    staffAuthClient.logout();
    router.push('/staff/entrar');
  }

  const colunas = funilCarregado
    ? Object.keys(funil).map((chave) => ({ chave, titulo: capitalizar(chave) }))
    : COLUNAS_PADRAO;

  return (
    <PanelLayout nomeStaff="" nomeTenant="" onSair={handleSair}>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-xl">Funil</h1>
          <Link href={`/staff/painel/vagas/${params.id}/editar`} className="font-ui text-sm text-accent underline">
            Editar vaga
          </Link>
        </div>
        {erro && <p className="text-danger-text">{erro}</p>}
        <KanbanBoard
          colunas={colunas}
          itens={funil}
          renderItem={(item: CandidaturaResumo) => (
            <Link href={`/staff/painel/candidaturas/${item.id}`}>{item.nomeCandidato}</Link>
          )}
          labelMover={(item: CandidaturaResumo) => `Mover ${item.nomeCandidato}`}
          onMoverItem={handleMover}
        />
      </div>
    </PanelLayout>
  );
}

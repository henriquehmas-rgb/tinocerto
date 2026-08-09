'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { KanbanBoard, PanelLayout } from '@tinocerto/design-system';
import { staffPanelClient, CandidaturaResumo, PerfilStaff } from '../../../../../lib/staff-panel-client';
import { staffAuthClient, isErroDeAutenticacao } from '../../../../../lib/staff-auth-client';

// Etapas conhecidas hoje, sempre mostradas como coluna (e como destino no
// menu Mover) mesmo quando ainda nao tem nenhuma candidatura -- e o caso
// mais comum de todos, uma vaga nova onde todo mundo esta em triagem.
// JobService.funil() no backend so inclui no objeto retornado as etapas que
// JA TEM ao menos uma candidatura (nunca emite chave pra etapa vazia), entao
// as colunas exibidas sao sempre a UNIAO desta lista padrao com as chaves
// reais de `funil` -- nunca a substituicao de uma pela outra. Isso garante
// que uma etapa nova/inesperada (ex.: 'oferta') tambem apareca quando
// existir candidatura nela, sem fazer 'entrevista' sumir quando ainda
// estiver vazia.
const COLUNAS_PADRAO = [
  { chave: 'triagem', titulo: 'Triagem' },
  { chave: 'entrevista', titulo: 'Entrevista' },
];

const NAV_LINKS = [
  { href: '/staff/painel', label: 'Dashboard' },
  { href: '/staff/painel/vagas', label: 'Vagas' },
];


function capitalizar(texto: string): string {
  if (!texto) return texto;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export default function FunilPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [funil, setFunil] = useState<Record<string, CandidaturaResumo[]>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [perfil, setPerfil] = useState<PerfilStaff | null>(null);

  const carregar = useCallback(() => {
    staffPanelClient
      .obterFunil(params.id)
      .then((dados) => {
        setFunil(dados);
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
    staffPanelClient.obterPerfil().then(setPerfil).catch(() => {});
  }, [carregar]);

  async function handleMover(candidatura: CandidaturaResumo, novaColuna: string) {
    await staffPanelClient.moverEtapa(candidatura.id, novaColuna);
    carregar();
  }

  function handleSair() {
    staffAuthClient.logout();
    router.push('/staff/entrar');
  }

  const chavesExtras = Object.keys(funil).filter(
    (chave) => !COLUNAS_PADRAO.some((coluna) => coluna.chave === chave),
  );
  const colunas = [
    ...COLUNAS_PADRAO,
    ...chavesExtras.map((chave) => ({ chave, titulo: capitalizar(chave) })),
  ];

  return (
    <PanelLayout nomeStaff={perfil?.email ?? ''} nomeTenant={perfil?.razaoSocial ?? ''} links={NAV_LINKS} onSair={handleSair}>
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

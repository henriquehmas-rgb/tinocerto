'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, PanelLayout } from '@tinocerto/design-system';
import { staffPanelClient, PerfilStaff } from '../../../../../lib/staff-panel-client';
import { staffAuthClient, isErroDeAutenticacao } from '../../../../../lib/staff-auth-client';

const NAV_LINKS = [
  { href: '/staff/painel', label: 'Dashboard' },
  { href: '/staff/painel/vagas', label: 'Vagas' },
];

export default function NovaVagaPage() {
  const router = useRouter();
  const [titulo, setTitulo] = useState('');
  const [requisitionId, setRequisitionId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [perfil, setPerfil] = useState<PerfilStaff | null>(null);

  useEffect(() => {
    // Esta tela nao faz nenhuma chamada a API no carregamento (so no
    // submit), entao sem essa checagem uma sessao expirada so seria
    // percebida depois do usuario preencher tudo e tentar salvar.
    staffPanelClient
      .obterPerfil()
      .then(setPerfil)
      .catch((e) => {
        if (isErroDeAutenticacao(e)) {
          router.push('/staff/entrar');
        }
      });
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await staffPanelClient.criarVaga({ titulo, requisitionId });
      router.push('/staff/painel/vagas');
    } catch (e) {
      if (isErroDeAutenticacao(e)) {
        router.push('/staff/entrar');
        return;
      }
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function handleSair() {
    staffAuthClient.logout();
    router.push('/staff/entrar');
  }

  return (
    <PanelLayout nomeStaff={perfil?.email ?? ''} nomeTenant={perfil?.razaoSocial ?? ''} links={NAV_LINKS} onSair={handleSair}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md p-6">
        <h1 className="font-display text-xl">Nova vaga</h1>
        {erro && <p className="text-danger-text">{erro}</p>}
        <label className="flex flex-col gap-1 font-ui text-sm">
          Título
          <input
            className="rounded-control px-3 py-2 border border-border"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 font-ui text-sm">
          ID da requisição
          <input
            className="rounded-control px-3 py-2 border border-border"
            value={requisitionId}
            onChange={(e) => setRequisitionId(e.target.value)}
            required
          />
        </label>
        <Button>{enviando ? 'Criando...' : 'Criar vaga'}</Button>
      </form>
    </PanelLayout>
  );
}

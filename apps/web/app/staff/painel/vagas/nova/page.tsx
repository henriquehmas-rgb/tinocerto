'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@tinocerto/design-system';
import { staffPanelClient } from '../../../../../lib/staff-panel-client';

export default function NovaVagaPage() {
  const router = useRouter();
  const [titulo, setTitulo] = useState('');
  const [requisitionId, setRequisitionId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await staffPanelClient.criarVaga({ titulo, requisitionId });
      router.push('/staff/painel');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
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
  );
}

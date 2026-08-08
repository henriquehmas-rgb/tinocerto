'use client';

import { FormEvent, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@tinocerto/design-system';
import { staffPanelClient } from '../../../../../../lib/staff-panel-client';

export default function EditarVagaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [habilidadesTexto, setHabilidadesTexto] = useState('');
  const [recrutadorIdsTexto, setRecrutadorIdsTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    const recrutadorIds = recrutadorIdsTexto
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const habilidadesExigidas = habilidadesTexto
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    try {
      await staffPanelClient.editarVaga(params.id, {
        titulo: titulo || undefined,
        descricao: descricao || undefined,
        habilidadesExigidas: habilidadesExigidas.length > 0 ? habilidadesExigidas : undefined,
      });
      await staffPanelClient.atribuirRecrutadores(params.id, recrutadorIds);
      router.push(`/staff/painel/vagas/${params.id}`);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md p-6">
      <h1 className="font-display text-xl">Editar vaga</h1>
      {erro && <p className="text-danger">{erro}</p>}
      <label className="flex flex-col gap-1 font-ui text-sm">
        Título
        <input className="rounded-control px-3 py-2 border border-border" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 font-ui text-sm">
        Descrição
        <textarea className="rounded-control px-3 py-2 border border-border" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 font-ui text-sm">
        Habilidades exigidas (separadas por vírgula)
        <input
          className="rounded-control px-3 py-2 border border-border"
          value={habilidadesTexto}
          onChange={(e) => setHabilidadesTexto(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 font-ui text-sm">
        IDs dos recrutadores (separados por vírgula)
        <input
          className="rounded-control px-3 py-2 border border-border"
          value={recrutadorIdsTexto}
          onChange={(e) => setRecrutadorIdsTexto(e.target.value)}
        />
      </label>
      <Button>Salvar</Button>
    </form>
  );
}

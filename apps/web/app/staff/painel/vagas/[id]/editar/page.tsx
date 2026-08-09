'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@tinocerto/design-system';
import { staffPanelClient } from '../../../../../../lib/staff-panel-client';

function parseIds(texto: string): string[] {
  return texto
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function arraysIguais(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((valor, indice) => valor === b[indice]);
}

export default function EditarVagaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [habilidadesTexto, setHabilidadesTexto] = useState('');
  const [recrutadorIdsTexto, setRecrutadorIdsTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  // null enquanto a vaga não foi carregada com sucesso -- usado no submit
  // para decidir se é seguro chamar atribuirRecrutadores (ver handleSubmit).
  const recrutadorIdsIniciaisRef = useRef<string[] | null>(null);

  useEffect(() => {
    staffPanelClient
      .obterVaga(params.id)
      .then((vaga) => {
        setTitulo(vaga.titulo ?? '');
        setDescricao(vaga.descricao ?? '');
        setHabilidadesTexto((vaga.habilidadesExigidas ?? []).join(', '));
        const recrutadorIds = vaga.recrutadorIds ?? [];
        setRecrutadorIdsTexto(recrutadorIds.join(', '));
        recrutadorIdsIniciaisRef.current = recrutadorIds;
      })
      .catch(() => {
        // Falha ao carregar a vaga atual: deixamos recrutadorIdsIniciaisRef
        // em null de propósito. handleSubmit trata null como "não mude nada"
        // -- nunca envia atribuirRecrutadores com base em um estado que não
        // conseguimos confirmar como o atual, para não apagar atribuições
        // existentes por engano.
      });
  }, [params.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    const recrutadorIds = parseIds(recrutadorIdsTexto);
    const habilidadesExigidas = parseIds(habilidadesTexto);
    try {
      await staffPanelClient.editarVaga(params.id, {
        titulo: titulo || undefined,
        descricao: descricao || undefined,
        habilidadesExigidas: habilidadesExigidas.length > 0 ? habilidadesExigidas : undefined,
      });
      const recrutadorIdsIniciais = recrutadorIdsIniciaisRef.current;
      const campoFoiAlterado = recrutadorIdsIniciais !== null && !arraysIguais(recrutadorIdsIniciais, recrutadorIds);
      if (campoFoiAlterado) {
        await staffPanelClient.atribuirRecrutadores(params.id, recrutadorIds);
      }
      router.push(`/staff/painel/vagas/${params.id}`);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md p-6">
      <h1 className="font-display text-xl">Editar vaga</h1>
      {erro && <p className="text-danger-text">{erro}</p>}
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

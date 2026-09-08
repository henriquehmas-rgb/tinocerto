'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Select } from '@tinocerto/design-system';
import { PainelShell } from '../../../../../components/painel-shell';
import { staffPanelClient, RequisitionResumo, MembroEquipe } from '../../../../../lib/staff-panel-client';
import { isErroDeAutenticacao } from '../../../../../lib/staff-auth-client';

export default function NovaVagaPage() {
  const router = useRouter();
  const [titulo, setTitulo] = useState('');
  const [requisitionId, setRequisitionId] = useState('');
  const [requisicoes, setRequisicoes] = useState<RequisitionResumo[] | null>(null);
  const [equipe, setEquipe] = useState<MembroEquipe[]>([]);
  const [recrutadorIds, setRecrutadorIds] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    function tratarFalha(e: unknown) {
      if (isErroDeAutenticacao(e)) {
        router.push('/staff/entrar');
        return;
      }
      setErro((e as Error).message);
    }
    staffPanelClient.obterPerfil().catch(tratarFalha);
    staffPanelClient
      .listarRequisicoes()
      .then((todas) => {
        const aprovadas = todas.filter((r) => r.status === 'aprovada');
        setRequisicoes(aprovadas);
        if (aprovadas.length === 1) setRequisitionId(aprovadas[0].id);
      })
      .catch(tratarFalha);
    staffPanelClient.listarEquipe().then(setEquipe).catch((e: unknown) => {
      console.error('Falha ao carregar a equipe para Nova vaga:', e);
    });
  }, [router]);

  function alternarRecrutador(id: string) {
    setRecrutadorIds((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    // Select (packages/design-system) usa Radix -- não é um <select> nativo
    // e não participa de validação HTML (um `required` no Select não
    // bloqueia o submit sozinho, ao contrário de um <select> de verdade).
    // Checagem explícita aqui é o que impede criar uma vaga sem requisição
    // quando há mais de uma aprovada e nenhuma foi escolhida.
    if (!requisitionId) {
      setErro('Selecione uma requisição');
      return;
    }
    setEnviando(true);
    try {
      const { id } = await staffPanelClient.criarVaga({
        titulo,
        requisitionId,
        recrutadorIds: Array.from(recrutadorIds),
      });
      router.push(`/staff/painel/vagas/${id}/editar`);
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

  return (
    <PainelShell breadcrumb={[{ label: 'Vagas', href: '/staff/painel/vagas' }, { label: 'Nova vaga' }]}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md">
        {erro && <p className="text-danger-text">{erro}</p>}
        <Field label="Título" htmlFor="titulo-vaga">
          <Input id="titulo-vaga" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
        </Field>
        {requisicoes === null ? null : requisicoes.length === 0 ? (
          <p className="font-ui text-sm text-text-secondary">
            Nenhuma requisição aprovada disponível. Abra e aprove uma requisição antes de criar a vaga.
          </p>
        ) : (
          <Select
            label="Requisição"
            value={requisitionId}
            onChange={setRequisitionId}
            options={requisicoes.map((r) => ({ value: r.id, label: r.titulo }))}
          />
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="font-ui text-sm text-text">Recrutadores</legend>
          <p className="font-ui text-xs text-text-secondary">Você é incluído automaticamente.</p>
          {equipe.map((membro) => (
            <label key={membro.id} className="flex items-center gap-2 font-ui text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={recrutadorIds.has(membro.id)}
                onChange={() => alternarRecrutador(membro.id)}
              />
              {membro.email}
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={enviando || requisicoes === null || requisicoes.length === 0}>
          {enviando ? 'Criando...' : 'Criar vaga'}
        </Button>
      </form>
    </PainelShell>
  );
}

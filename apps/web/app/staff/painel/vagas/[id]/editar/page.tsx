'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, PanelLayout } from '@tinocerto/design-system';
import { staffPanelClient, PerfilStaff, InstrumentoAtivo } from '../../../../../../lib/staff-panel-client';
import { staffAuthClient, isErroDeAutenticacao } from '../../../../../../lib/staff-auth-client';

function parseIds(texto: string): string[] {
  return texto
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

const NAV_LINKS = [
  { href: '/staff/painel', label: 'Dashboard' },
  { href: '/staff/painel/vagas', label: 'Vagas' },
  { href: '/staff/painel/configuracoes', label: 'Configurações' },
];

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
  const [instrumentVersionId, setInstrumentVersionId] = useState('');
  const [instrumentos, setInstrumentos] = useState<InstrumentoAtivo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  // true quando o carregamento inicial falhou por um motivo que não seja
  // sessão ausente/expirada (ex.: rede, 500, vaga não encontrada). Usado
  // para desabilitar o campo de recrutadores -- ver handleSubmit e o JSX
  // abaixo.
  const [carregamentoFalhou, setCarregamentoFalhou] = useState(false);
  const [perfil, setPerfil] = useState<PerfilStaff | null>(null);
  // null enquanto a vaga não foi carregada com sucesso -- usado no submit
  // para decidir se é seguro chamar atribuirRecrutadores (ver handleSubmit).
  const recrutadorIdsIniciaisRef = useRef<string[] | null>(null);

  useEffect(() => {
    staffPanelClient.obterPerfil().then(setPerfil).catch(() => {});
    staffPanelClient.obterInstrumentosAtivos().then(setInstrumentos).catch(() => {});
    staffPanelClient
      .obterVaga(params.id)
      .then((vaga) => {
        setTitulo(vaga.titulo ?? '');
        setDescricao(vaga.descricao ?? '');
        setHabilidadesTexto((vaga.habilidadesExigidas ?? []).join(', '));
        const recrutadorIds = vaga.recrutadorIds ?? [];
        setRecrutadorIdsTexto(recrutadorIds.join(', '));
        setInstrumentVersionId(vaga.instrumentVersionId ?? '');
        recrutadorIdsIniciaisRef.current = recrutadorIds;
      })
      .catch((e) => {
        if (isErroDeAutenticacao(e)) {
          router.push('/staff/entrar');
          return;
        }
        // Falha ao carregar a vaga atual (ex.: rede, 500, vaga não
        // encontrada): recrutadorIdsIniciaisRef fica em null de propósito.
        // handleSubmit trata null como "não mude nada" -- nunca envia
        // atribuirRecrutadores com base em um estado que não conseguimos
        // confirmar como o atual, para não apagar atribuições existentes
        // por engano. Além disso, avisamos o usuário (setErro) e
        // desabilitamos o campo de recrutadores, para deixar claro que a
        // edição não está operando com dados carregados de verdade -- sem
        // isso, o formulário ficava vazio em silêncio e uma submissão
        // parecia ter dado tudo certo mesmo tendo ignorado o que foi
        // digitado ali.
        setErro((e as Error).message);
        setCarregamentoFalhou(true);
      });
  }, [params.id, router]);

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
        instrumentVersionId: instrumentVersionId || undefined,
      });
      const recrutadorIdsIniciais = recrutadorIdsIniciaisRef.current;
      const campoFoiAlterado = recrutadorIdsIniciais !== null && !arraysIguais(recrutadorIdsIniciais, recrutadorIds);
      if (campoFoiAlterado) {
        await staffPanelClient.atribuirRecrutadores(params.id, recrutadorIds);
      }
      router.push(`/staff/painel/vagas/${params.id}`);
    } catch (e) {
      if (isErroDeAutenticacao(e)) {
        router.push('/staff/entrar');
        return;
      }
      setErro((e as Error).message);
    }
  }

  function handleSair() {
    staffAuthClient.logout();
    router.push('/staff/entrar');
  }

  return (
    <PanelLayout nomeStaff={perfil?.email ?? ''} nomeTenant={perfil?.razaoSocial ?? ''} links={NAV_LINKS} onSair={handleSair}>
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
            disabled={carregamentoFalhou}
          />
        </label>
        <label className="flex flex-col gap-1 font-ui text-sm">
          Instrumento de assessment
          <select
            className="rounded-control px-3 py-2 border border-border bg-surface text-text"
            value={instrumentVersionId}
            onChange={(e) => setInstrumentVersionId(e.target.value)}
          >
            <option value="">Nenhum (candidatura nao dispara assessment)</option>
            {instrumentos.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nome} (v{i.versao})
              </option>
            ))}
          </select>
        </label>
        <Button>Salvar</Button>
      </form>
    </PanelLayout>
  );
}

'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, Field, Input, TextArea, ChipsInput } from '@tinocerto/design-system';
import { PainelShell } from '../../../../../../components/painel-shell';
import { staffPanelClient, InstrumentoAtivo, JobDescriptionSuggestion, MembroEquipe } from '../../../../../../lib/staff-panel-client';
import { isErroDeAutenticacao } from '../../../../../../lib/staff-auth-client';
import { wordDiff } from '../../../../../../lib/word-diff';

function arraysIguais(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((valor) => b.includes(valor));
}

export default function EditarVagaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [habilidades, setHabilidades] = useState<string[]>([]);
  const [equipe, setEquipe] = useState<MembroEquipe[]>([]);
  const [recrutadorIds, setRecrutadorIds] = useState<Set<string>>(new Set());
  const [instrumentVersionId, setInstrumentVersionId] = useState('');
  const [instrumentos, setInstrumentos] = useState<InstrumentoAtivo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [sugestaoDescricao, setSugestaoDescricao] = useState<JobDescriptionSuggestion | null>(null);
  const [erroSugestao, setErroSugestao] = useState<string | null>(null);
  const [gerandoSugestao, setGerandoSugestao] = useState(false);
  // true quando o carregamento inicial falhou por um motivo que não seja
  // sessão ausente/expirada (ex.: rede, 500, vaga não encontrada). Usado
  // para desabilitar os checkboxes de recrutadores -- ver handleSubmit e o
  // JSX abaixo. Mesmo raciocínio de antes, só que agora sobre checkboxes em
  // vez de um <input> de texto.
  const [carregamentoFalhou, setCarregamentoFalhou] = useState(false);
  // null enquanto a vaga não foi carregada com sucesso -- usado no submit
  // para decidir se é seguro chamar atribuirRecrutadores (ver handleSubmit).
  const recrutadorIdsIniciaisRef = useRef<string[] | null>(null);
  // Mesmo padrão acima, para o instrumento. `undefined` = carregamento
  // inicial ainda não confirmado; string | null = valor real vindo do
  // banco. Ver comentário original em handleSubmit sobre por que isto
  // distingue "usuário quer Nenhum" de "nunca soubemos o valor real".
  const instrumentVersionIdInicialRef = useRef<string | null | undefined>(undefined);

  const diffPartes = useMemo(
    () => (sugestaoDescricao ? wordDiff(sugestaoDescricao.textoOriginal, sugestaoDescricao.textoSugerido) : []),
    [sugestaoDescricao],
  );

  useEffect(() => {
    staffPanelClient.obterInstrumentosAtivos().then(setInstrumentos).catch(() => {});
    staffPanelClient.listarEquipe().then(setEquipe).catch((e: unknown) => {
      console.error('Falha ao carregar a equipe para Editar vaga:', e);
    });
    staffPanelClient
      .obterVaga(params.id)
      .then((vaga) => {
        setTitulo(vaga.titulo ?? '');
        setDescricao(vaga.descricao ?? '');
        setHabilidades(vaga.habilidadesExigidas ?? []);
        const recrutadorIdsAtuais = vaga.recrutadorIds ?? [];
        setRecrutadorIds(new Set(recrutadorIdsAtuais));
        setInstrumentVersionId(vaga.instrumentVersionId ?? '');
        instrumentVersionIdInicialRef.current = vaga.instrumentVersionId;
        recrutadorIdsIniciaisRef.current = recrutadorIdsAtuais;
      })
      .catch((e) => {
        if (isErroDeAutenticacao(e)) {
          router.push('/staff/entrar');
          return;
        }
        // Falha ao carregar a vaga atual: recrutadorIdsIniciaisRef fica em
        // null de propósito. handleSubmit trata null como "não mude nada"
        // -- nunca envia atribuirRecrutadores com base num estado que não
        // conseguimos confirmar como o atual.
        setErro((e as Error).message);
        setCarregamentoFalhou(true);
      });
  }, [params.id, router]);

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
    try {
      await staffPanelClient.editarVaga(params.id, {
        titulo: titulo || undefined,
        descricao: descricao || undefined,
        habilidadesExigidas: habilidades.length > 0 ? habilidades : undefined,
        instrumentVersionId:
          instrumentVersionIdInicialRef.current !== undefined ? instrumentVersionId || null : undefined,
      });
      const recrutadorIdsIniciais = recrutadorIdsIniciaisRef.current;
      const recrutadorIdsAtuais = Array.from(recrutadorIds);
      const campoFoiAlterado =
        recrutadorIdsIniciais !== null && !arraysIguais(recrutadorIdsIniciais, recrutadorIdsAtuais);
      if (campoFoiAlterado) {
        await staffPanelClient.atribuirRecrutadores(params.id, recrutadorIdsAtuais);
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

  async function handleSugerirReescrita() {
    setErroSugestao(null);
    setGerandoSugestao(true);
    try {
      const sugestao = await staffPanelClient.gerarSugestaoDescricao(params.id);
      setSugestaoDescricao(sugestao);
    } catch (e) {
      setErroSugestao((e as Error).message);
    } finally {
      setGerandoSugestao(false);
    }
  }

  async function handleAplicarSugestao() {
    if (!sugestaoDescricao) return;
    setErroSugestao(null);
    try {
      const resultado = await staffPanelClient.aplicarSugestaoDescricao(params.id, sugestaoDescricao.id);
      setDescricao(resultado.descricao);
      setSugestaoDescricao(null);
    } catch (e) {
      setErroSugestao((e as Error).message);
    }
  }

  return (
    <PainelShell breadcrumb={[{ label: 'Vagas', href: '/staff/painel/vagas' }, { label: 'Editar vaga' }]}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md">
        {erro && <p className="text-danger-text">{erro}</p>}
        <Field label="Título" htmlFor="titulo-vaga">
          <Input id="titulo-vaga" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </Field>
        <Field label="Descrição" htmlFor="descricao-vaga">
          <TextArea id="descricao-vaga" value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={6} />
        </Field>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={handleSugerirReescrita} disabled={gerandoSugestao}>
            {gerandoSugestao ? 'Gerando...' : 'Sugerir reescrita'}
          </Button>
          {erroSugestao && <p className="text-danger-text">{erroSugestao}</p>}
          {sugestaoDescricao && (
            <div className="border border-border rounded-card p-3 bg-surface flex flex-col gap-2">
              <p className="font-ui text-sm">
                {diffPartes.map((parte, i) => {
                  if (parte.tipo === 'removido') {
                    return (
                      <span key={i} className="line-through text-danger-text">
                        {parte.texto}
                      </span>
                    );
                  }
                  if (parte.tipo === 'adicionado') {
                    return (
                      <span key={i} className="text-accent font-medium">
                        {parte.texto}
                      </span>
                    );
                  }
                  return <span key={i}>{parte.texto}</span>;
                })}
              </p>
              <div className="flex gap-2">
                <Button onClick={handleAplicarSugestao}>Aplicar</Button>
                <Button variant="secondary" onClick={() => setSugestaoDescricao(null)}>
                  Descartar
                </Button>
              </div>
            </div>
          )}
        </div>
        <Field label="Habilidades exigidas" htmlFor="habilidades-vaga">
          <ChipsInput id="habilidades-vaga" valores={habilidades} onChange={setHabilidades} placeholder="Digite e pressione Enter" />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="font-ui text-sm text-text">Recrutadores</legend>
          {equipe.map((membro) => (
            <label key={membro.id} className="flex items-center gap-2 font-ui text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={recrutadorIds.has(membro.id)}
                onChange={() => alternarRecrutador(membro.id)}
                disabled={carregamentoFalhou}
              />
              {membro.email}
            </label>
          ))}
        </fieldset>
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
        <Button type="submit">Salvar</Button>
      </form>
    </PainelShell>
  );
}

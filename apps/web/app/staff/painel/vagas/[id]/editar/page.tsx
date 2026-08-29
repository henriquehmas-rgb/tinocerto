'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@tinocerto/design-system';
import { PainelShell } from '../../../../../../components/painel-shell';
import { staffPanelClient, InstrumentoAtivo, JobDescriptionSuggestion } from '../../../../../../lib/staff-panel-client';
import { isErroDeAutenticacao } from '../../../../../../lib/staff-auth-client';
import { wordDiff } from '../../../../../../lib/word-diff';

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
  const [instrumentVersionId, setInstrumentVersionId] = useState('');
  const [instrumentos, setInstrumentos] = useState<InstrumentoAtivo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [sugestaoDescricao, setSugestaoDescricao] = useState<JobDescriptionSuggestion | null>(null);
  const [erroSugestao, setErroSugestao] = useState<string | null>(null);
  const [gerandoSugestao, setGerandoSugestao] = useState(false);
  // true quando o carregamento inicial falhou por um motivo que não seja
  // sessão ausente/expirada (ex.: rede, 500, vaga não encontrada). Usado
  // para desabilitar o campo de recrutadores -- ver handleSubmit e o JSX
  // abaixo.
  const [carregamentoFalhou, setCarregamentoFalhou] = useState(false);
  // null enquanto a vaga não foi carregada com sucesso -- usado no submit
  // para decidir se é seguro chamar atribuirRecrutadores (ver handleSubmit).
  const recrutadorIdsIniciaisRef = useRef<string[] | null>(null);
  // Mesmo padrão acima, para o instrumento. `undefined` = carregamento
  // inicial ainda não confirmado (nunca chegamos no .then de obterVaga);
  // string | null = valor real vindo do banco. O envio SEMPRE explícito de
  // instrumentVersionId (null para "Nenhum") é correto quando a vaga
  // carregou -- mas se `obterVaga` falhar, o campo do formulário fica em
  // '' sem nunca ter sido preenchido com o valor real, e enviar `null`
  // nesse caso desvincularia silenciosamente um instrumento que a vaga já
  // tinha. Este ref é o que distingue "usuário quer Nenhum" de "nunca
  // soubemos o valor real".
  const instrumentVersionIdInicialRef = useRef<string | null | undefined>(undefined);

  const diffPartes = useMemo(
    () => (sugestaoDescricao ? wordDiff(sugestaoDescricao.textoOriginal, sugestaoDescricao.textoSugerido) : []),
    [sugestaoDescricao],
  );

  useEffect(() => {
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
        instrumentVersionIdInicialRef.current = vaga.instrumentVersionId;
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
        // Sempre envia (nunca omite) QUANDO o carregamento inicial teve
        // sucesso: "" no seletor precisa chegar como null explícito no body
        // para o backend distinguir "desvincular" de "campo não enviado" --
        // ver JobService.editar. Omitir sempre (|| undefined) fazia o
        // seletor em "Nenhum" nunca desvincular a vaga de verdade. Mas se
        // `obterVaga` falhou (instrumentVersionIdInicialRef.current ainda
        // undefined), o formulário nunca viu o valor real -- enviar `null`
        // nesse caso desvincularia um instrumento que a vaga já tinha, sem
        // o usuário ter tocado nesse campo. Mesmo padrão de
        // recrutadorIdsIniciaisRef logo abaixo: omite o campo por completo
        // quando não sabemos o valor real, preservando o que já está gravado.
        instrumentVersionId:
          instrumentVersionIdInicialRef.current !== undefined ? instrumentVersionId || null : undefined,
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md p-6">
        {erro && <p className="text-danger-text">{erro}</p>}
        <label className="flex flex-col gap-1 font-ui text-sm">
          Título
          <input className="rounded-control px-3 py-2 border border-border" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 font-ui text-sm">
          Descrição
          <textarea className="rounded-control px-3 py-2 border border-border" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </label>
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
        <Button type="submit">Salvar</Button>
      </form>
    </PainelShell>
  );
}

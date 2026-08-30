'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { KanbanBoard, CandidateCard, Card, Badge, Button, Table, TabelaDensa, Paginacao, BarraSelecao, Toast, type ColunaTabela } from '@tinocerto/design-system';
import { PainelShell } from '../../../../../components/painel-shell';
import { staffPanelClient, CandidaturaResumo, RoteiroEntrevista, VagaCompleta, ImpactoAdversoRow, InterviewQuestionSuggestion } from '../../../../../lib/staff-panel-client';
import { isErroDeAutenticacao } from '../../../../../lib/staff-auth-client';
import { montarChips, resolverDestino, idadeRelativa, rotuloAssessment, rotuloOrigem } from '../../../../../lib/funil-formatacao';
import { achatarFunil, ordenarCandidaturas, paginar, type ColunaOrdenavel, type LinhaFunil } from '../../../../../lib/funil-tabela';
import { lerVisaoPreferida, salvarVisaoPreferida, type VisaoFunil } from '../../../../../lib/funil-view-provider';

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

function capitalizar(texto: string): string {
  if (!texto) return texto;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function agruparImpactoAdverso(rows: ImpactoAdversoRow[]): Record<string, Record<string, ImpactoAdversoRow[]>> {
  const porEtapa: Record<string, Record<string, ImpactoAdversoRow[]>> = {};
  for (const row of rows) {
    const [dimensao] = row.grupoDemografico.split(':');
    porEtapa[row.etapa] ??= {};
    porEtapa[row.etapa][dimensao] ??= [];
    porEtapa[row.etapa][dimensao].push(row);
  }
  return porEtapa;
}

export default function FunilPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [funil, setFunil] = useState<Record<string, CandidaturaResumo[]>>({});
  const [conversao, setConversao] = useState<Record<string, number | null>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [vaga, setVaga] = useState<VagaCompleta | null>(null);
  const [roteiro, setRoteiro] = useState<RoteiroEntrevista | null>(null);
  const [carregandoRoteiro, setCarregandoRoteiro] = useState(true);
  const [impactoAdverso, setImpactoAdverso] = useState<ImpactoAdversoRow[]>([]);
  const [carregandoImpacto, setCarregandoImpacto] = useState(true);
  const [perguntasSugeridas, setPerguntasSugeridas] = useState<InterviewQuestionSuggestion | null>(null);
  const [erroPerguntas, setErroPerguntas] = useState<string | null>(null);
  const [gerandoPerguntas, setGerandoPerguntas] = useState(false);
  const [visao, setVisao] = useState<VisaoFunil>('kanban');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [ordenacao, setOrdenacao] = useState<{ coluna: ColunaOrdenavel; direcao: 'asc' | 'desc' } | null>({
    coluna: 'idade',
    direcao: 'asc',
  });
  const [pagina, setPagina] = useState(1);
  const [toast, setToast] = useState<{ mensagem: string; acao?: { rotulo: string; onClick: () => void } } | null>(null);
  // Menu de destino do "Mover etapa" em lote: não é o DropdownMenu do Radix
  // que o card individual usa (ver KanbanColumn) -- o lote pode conter
  // candidaturas de etapas de origem DIFERENTES entre si, então não existe
  // um único `colunasDestino` (que é "todas menos a etapa do item") capaz
  // de servir o lote inteiro. A escolha aqui é mostrar todas as etapas
  // conhecidas (`colunas`) como destino possível -- mais simples que tentar
  // calcular a interseção de destinos válidos por item.
  const [mostrandoMenuLote, setMostrandoMenuLote] = useState(false);

  const carregar = useCallback(() => {
    staffPanelClient
      .obterFunil(params.id)
      .then((dados) => {
        setFunil(dados.funil);
        setConversao(dados.conversao);
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
    staffPanelClient.obterVaga(params.id).then(setVaga).catch(() => {});
    staffPanelClient
      .obterRoteiroEntrevista(params.id)
      .then(setRoteiro)
      .catch(() => {})
      .finally(() => setCarregandoRoteiro(false));
    staffPanelClient
      .obterImpactoAdverso(params.id)
      .then(setImpactoAdverso)
      .catch(() => {})
      .finally(() => setCarregandoImpacto(false));
  }, [carregar, params.id]);

  // Ler a visão preferida só depois de montar -- lendo do localStorage
  // durante o render inicial divergiria do HTML gerado no servidor (mesmo
  // motivo do ThemeProvider).
  useEffect(() => {
    setVisao(lerVisaoPreferida());
  }, []);

  function trocarVisao(proxima: VisaoFunil) {
    setVisao(proxima);
    salvarVisaoPreferida(proxima);
  }

  async function handleGerarRoteiro() {
    if (!vaga) return;
    try {
      await staffPanelClient.gerarRoteiroEntrevista({
        jobId: params.id,
        tituloVaga: vaga.titulo,
        textoRequisicao: vaga.descricao,
      });
      staffPanelClient.obterRoteiroEntrevista(params.id).then(setRoteiro).catch(() => {});
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function handlePublicarRoteiro() {
    if (!roteiro) return;
    try {
      await staffPanelClient.publicarRoteiroEntrevista(roteiro.id);
      staffPanelClient.obterRoteiroEntrevista(params.id).then(setRoteiro).catch(() => {});
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function handleGerarPerguntas() {
    if (!roteiro?.publishedVersionId) return;
    setErroPerguntas(null);
    setGerandoPerguntas(true);
    try {
      const sugestao = await staffPanelClient.gerarPerguntasEntrevista(roteiro.publishedVersionId);
      setPerguntasSugeridas(sugestao);
    } catch (e) {
      setErroPerguntas((e as Error).message);
    } finally {
      setGerandoPerguntas(false);
    }
  }

  async function moverCandidatura(applicationId: string, destino: string) {
    const anterior = funil;
    // Otimista: move no estado local antes da resposta, e desfaz se falhar.
    setFunil((atual) => {
      const proximo: Record<string, CandidaturaResumo[]> = {};
      let movida: CandidaturaResumo | undefined;
      for (const [etapa, lista] of Object.entries(atual)) {
        proximo[etapa] = lista.filter((c) => {
          if (c.id !== applicationId) return true;
          movida = c;
          return false;
        });
      }
      if (movida) proximo[destino] = [...(proximo[destino] ?? []), movida];
      return proximo;
    });

    try {
      await staffPanelClient.moverEtapa(applicationId, destino);
      // Limpa um erro de um movimento anterior que tinha falhado -- senão
      // "Transição não permitida" continuava na tela por todo movimento
      // bem-sucedido seguinte, mentindo sobre o estado atual.
      setErro(null);
      carregar();
    } catch (e) {
      setFunil(anterior);
      setErro((e as Error).message);
    }
  }

  function handleMover(candidatura: CandidaturaResumo, novaColuna: string) {
    void moverCandidatura(candidatura.id, novaColuna);
  }

  // `payload` vem do dataTransfer do próprio evento de drag (ver
  // CandidateCard/KanbanColumn), não de um ref -- um ref setado no
  // dragStart e só limpo no drop ficava com um id desatualizado sempre
  // que o drag era abortado sem soltar em lugar nenhum (Esc, ou soltar
  // fora do board). Como a coluna sempre chamava preventDefault, um drop
  // de arquivo/texto alheio nesse estado usava o id antigo pra mover uma
  // candidatura que o recrutador nunca tocou.
  function handleSoltar(chaveDestino: string, payload: string) {
    if (!payload) return;
    const destino = resolverDestino(funil, payload, chaveDestino);
    if (destino === null) return;
    void moverCandidatura(payload, destino);
  }

  async function moverEmLote(applicationIds: string[], etapaDestino: string) {
    // Cada item guarda a PRÓPRIA etapa de origem -- o lote pode conter
    // candidaturas vindas de etapas diferentes, e desfazer precisa devolver
    // cada uma pra onde ela estava, não pra uma etapa comum.
    const origem = new Map<string, string>();
    for (const [etapa, candidaturas] of Object.entries(funil)) {
      for (const c of candidaturas) {
        if (applicationIds.includes(c.id)) origem.set(c.id, etapa);
      }
    }

    let sucesso = 0;
    let falha = 0;
    // Sequencial, não Promise.all: o pool de conexões do Postgres tem
    // max=20 -- disparar dezenas em paralelo o esgotaria sob uso
    // concorrente de vários recrutadores.
    for (const id of applicationIds) {
      try {
        await staffPanelClient.moverEtapa(id, etapaDestino);
        sucesso++;
      } catch {
        falha++;
      }
    }

    setSelecionados(new Set());
    carregar();

    const mensagem = falha === 0 ? `${sucesso} movidos` : `${sucesso} movidos, ${falha} falharam`;
    setToast({
      mensagem,
      acao:
        sucesso > 0
          ? {
              rotulo: 'Desfazer',
              onClick: () => void desfazerLote([...origem.entries()].filter(([id]) => id)),
            }
          : undefined,
    });
  }

  async function desfazerLote(itens: [string, string][]) {
    for (const [id, etapaAnterior] of itens) {
      try {
        await staffPanelClient.moverEtapa(id, etapaAnterior);
      } catch (e) {
        setErro((e as Error).message);
      }
    }
    carregar();
    setToast(null);
  }

  function handleOrdenacaoChange(coluna: string) {
    setOrdenacao((atual) => {
      if (atual?.coluna !== coluna) return { coluna: coluna as ColunaOrdenavel, direcao: 'asc' };
      if (atual.direcao === 'asc') return { coluna: coluna as ColunaOrdenavel, direcao: 'desc' };
      return null;
    });
    setPagina(1);
    setSelecionados(new Set());
  }

  function handlePaginaChange(proxima: number) {
    setPagina(proxima);
    setSelecionados(new Set());
  }

  const chavesExtras = Object.keys(funil).filter(
    (chave) => !COLUNAS_PADRAO.some((coluna) => coluna.chave === chave),
  );
  const colunas = [
    ...COLUNAS_PADRAO,
    ...chavesExtras.map((chave) => ({ chave, titulo: capitalizar(chave) })),
  ].map((coluna) => ({ ...coluna, conversao: conversao[coluna.chave] ?? null }));

  const linhasOrdenadas = ordenarCandidaturas(achatarFunil(funil), ordenacao, new Date(), colunas.map((c) => c.chave));
  const { pagina: linhasDaPagina, totalPaginas } = paginar(linhasOrdenadas, pagina, 25);

  const colunasTabela: ColunaTabela<LinhaFunil>[] = [
    { chave: 'nome', titulo: 'Nome', largura: '1fr', ordenavel: true, render: (l) => (
      <Link href={`/staff/painel/candidaturas/${l.id}`} className="text-accent underline">
        {l.nomeCandidato}
      </Link>
    ) },
    { chave: 'etapa', titulo: 'Etapa', largura: '128px', ordenavel: true, render: (l) => capitalizar(l.etapa) },
    { chave: 'fit', titulo: 'Fit', largura: '80px', alinhamento: 'direita', ordenavel: true, render: (l) => (l.scoreAderencia ?? '') },
    { chave: 'assessment', titulo: 'Assessment', largura: '122px', render: (l) => rotuloAssessment(l.assessmentStatus) ?? '' },
    { chave: 'origem', titulo: 'Origem', largura: '128px', render: (l) => rotuloOrigem(l.origemCanal) ?? '' },
    { chave: 'idade', titulo: 'Idade', largura: '96px', alinhamento: 'direita', ordenavel: true, render: (l) => idadeRelativa(l.criadoEm, new Date()) },
  ];

  return (
    <PainelShell
      breadcrumb={[{ label: 'Vagas', href: '/staff/painel/vagas' }, { label: 'Funil' }]}
      acao={
        <Link href={`/staff/painel/vagas/${params.id}/editar`} className="font-ui text-sm text-accent underline">
          Editar vaga
        </Link>
      }
    >
      <div>
        {erro && <p className="text-danger-text">{erro}</p>}
        <Card>
          <div className="flex items-center justify-between mb-2">
            <p className="font-ui text-sm font-medium text-text">Roteiro de entrevista</p>
            {roteiro?.status === 'publicado' && <Badge tone="sucesso">Publicado</Badge>}
          </div>
          {!carregandoRoteiro && !roteiro && (
            <Button onClick={handleGerarRoteiro}>Gerar roteiro de entrevista</Button>
          )}
          {roteiro && (
            <div className="flex flex-col gap-2">
              {roteiro.competencias.map((competencia) => (
                <div key={competencia.nome}>
                  <p className="font-ui text-sm font-medium text-text">{competencia.nome}</p>
                </div>
              ))}
              {roteiro.status === 'rascunho' && (
                <Button onClick={handlePublicarRoteiro}>Publicar</Button>
              )}
              {roteiro.publishedVersionId && (
                <div className="mt-2 flex flex-col gap-2">
                  <Button variant="secondary" onClick={handleGerarPerguntas} disabled={gerandoPerguntas}>
                    {gerandoPerguntas ? 'Gerando...' : 'Sugerir perguntas'}
                  </Button>
                  {erroPerguntas && <p className="text-danger-text">{erroPerguntas}</p>}
                  {perguntasSugeridas && (
                    <div className="flex flex-col gap-3">
                      {perguntasSugeridas.itens.map((item) => (
                        <div key={item.competencyId}>
                          <p className="font-ui text-sm font-medium text-text">{item.nome}</p>
                          <ul className="list-disc pl-5">
                            {item.perguntas.map((pergunta, i) => (
                              <li key={i} className="font-ui text-sm text-text-secondary">
                                {pergunta}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
        <Card>
          <p className="font-ui text-sm font-medium text-text mb-2">Impacto adverso</p>
          {!carregandoImpacto && impactoAdverso.length === 0 && (
            <p className="font-ui text-sm text-text-secondary">
              Ainda não há dados suficientes para calcular impacto adverso nesta vaga (mínimo de 5 candidaturas por grupo).
            </p>
          )}
          {!carregandoImpacto && impactoAdverso.length > 0 && (
            <div className="flex flex-col gap-4">
              {Object.entries(agruparImpactoAdverso(impactoAdverso)).map(([etapa, dimensoes]) => (
                <div key={etapa}>
                  <p className="font-ui text-sm font-medium text-text mb-2">{capitalizar(etapa)}</p>
                  <div className="flex flex-col gap-3">
                    {Object.entries(dimensoes).map(([dimensao, linhas]) => (
                      <div key={dimensao}>
                        <p className="font-ui text-xs text-text-secondary mb-1">{capitalizar(dimensao)}</p>
                        <Table
                          columns={[
                            { header: 'Grupo', render: (r: ImpactoAdversoRow) => r.grupoDemografico.split(':')[1] },
                            { header: 'Taxa de seleção', render: (r: ImpactoAdversoRow) => `${(r.taxaSelecao * 100).toFixed(1)}%` },
                            {
                              header: 'Razão 4/5',
                              render: (r: ImpactoAdversoRow) => (
                                <span className="flex items-center gap-2">
                                  {r.razao4Quintos.toFixed(2)}
                                  {r.razao4Quintos < 0.8 && <Badge tone="alerta">Abaixo de 0,8</Badge>}
                                </span>
                              ),
                            },
                          ]}
                          rows={linhas}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="mb-2 flex items-center justify-between">
          <div className="flex gap-2">
            <Button variant={visao === 'kanban' ? 'primary' : 'secondary'} onClick={() => trocarVisao('kanban')}>
              Visão em kanban
            </Button>
            <Button variant={visao === 'tabela' ? 'primary' : 'secondary'} onClick={() => trocarVisao('tabela')}>
              Visão em tabela
            </Button>
          </div>
          {selecionados.size > 0 && (
            <BarraSelecao
              quantidade={selecionados.size}
              onMoverEtapa={() => setMostrandoMenuLote(true)}
              onLimparSelecao={() => setSelecionados(new Set())}
            />
          )}
        </div>

        {visao === 'kanban' && (
          <KanbanBoard
            colunas={colunas}
            itens={funil}
            onMoverItem={handleMover}
            onSoltarItem={handleSoltar}
            labelMover={(c: CandidaturaResumo) => `Mover ${c.nomeCandidato}`}
            renderItem={(c: CandidaturaResumo, acao) => (
              <CandidateCard
                nome={c.nomeCandidato}
                scoreAderencia={c.scoreAderencia}
                chips={montarChips(c, new Date())}
                acao={acao}
                arrastavel
                payloadArraste={c.id}
                href={`/staff/painel/candidaturas/${c.id}`}
                linkAs={Link}
              />
            )}
          />
        )}

        {visao === 'tabela' && (
          <>
            <TabelaDensa
              colunas={colunasTabela}
              linhas={linhasDaPagina}
              selecionados={selecionados}
              onSelecaoChange={setSelecionados}
              ordenacao={ordenacao}
              onOrdenacaoChange={handleOrdenacaoChange}
            />
            <Paginacao
              paginaAtual={pagina}
              totalPaginas={totalPaginas}
              totalItens={linhasOrdenadas.length}
              itensPorPagina={25}
              onPaginaChange={handlePaginaChange}
            />
          </>
        )}

        {mostrandoMenuLote && (
          <div className="mt-2 flex gap-2">
            {colunas.map((c) => (
              <Button
                key={c.chave}
                variant="secondary"
                onClick={() => {
                  setMostrandoMenuLote(false);
                  void moverEmLote([...selecionados], c.chave);
                }}
              >
                {c.titulo}
              </Button>
            ))}
          </div>
        )}

        {toast && (
          <Toast mensagem={toast.mensagem} acao={toast.acao} aoFechar={() => setToast(null)} />
        )}
      </div>
    </PainelShell>
  );
}

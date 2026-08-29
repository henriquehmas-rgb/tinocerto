'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { KanbanBoard, Card, Badge, Button, Table } from '@tinocerto/design-system';
import { PainelShell } from '../../../../../components/painel-shell';
import { staffPanelClient, CandidaturaResumo, RoteiroEntrevista, VagaCompleta, ImpactoAdversoRow, InterviewQuestionSuggestion } from '../../../../../lib/staff-panel-client';
import { isErroDeAutenticacao } from '../../../../../lib/staff-auth-client';

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
  const [erro, setErro] = useState<string | null>(null);
  const [vaga, setVaga] = useState<VagaCompleta | null>(null);
  const [roteiro, setRoteiro] = useState<RoteiroEntrevista | null>(null);
  const [carregandoRoteiro, setCarregandoRoteiro] = useState(true);
  const [impactoAdverso, setImpactoAdverso] = useState<ImpactoAdversoRow[]>([]);
  const [carregandoImpacto, setCarregandoImpacto] = useState(true);
  const [perguntasSugeridas, setPerguntasSugeridas] = useState<InterviewQuestionSuggestion | null>(null);
  const [erroPerguntas, setErroPerguntas] = useState<string | null>(null);
  const [gerandoPerguntas, setGerandoPerguntas] = useState(false);

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

  async function handleMover(candidatura: CandidaturaResumo, novaColuna: string) {
    await staffPanelClient.moverEtapa(candidatura.id, novaColuna);
    carregar();
  }

  const chavesExtras = Object.keys(funil).filter(
    (chave) => !COLUNAS_PADRAO.some((coluna) => coluna.chave === chave),
  );
  const colunas = [
    ...COLUNAS_PADRAO,
    ...chavesExtras.map((chave) => ({ chave, titulo: capitalizar(chave) })),
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
    </PainelShell>
  );
}

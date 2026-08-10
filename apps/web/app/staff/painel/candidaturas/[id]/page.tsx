'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, Card, ScoreChart, PanelLayout } from '@tinocerto/design-system';
import { staffPanelClient, RelatorioAssessment, CandidaturaDetalhe, PerfilStaff, RoteiroEntrevista, AgendaEntrevista, ScorecardRow } from '../../../../../lib/staff-panel-client';
import { staffAuthClient, isErroDeAutenticacao } from '../../../../../lib/staff-auth-client';

const NAV_LINKS = [
  { href: '/staff/painel', label: 'Dashboard' },
  { href: '/staff/painel/vagas', label: 'Vagas' },
  { href: '/staff/painel/configuracoes', label: 'Configurações' },
];

export default function CandidaturaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [dados, setDados] = useState<RelatorioAssessment | null>(null);
  const [candidatura, setCandidatura] = useState<CandidaturaDetalhe | null>(null);
  const [perfil, setPerfil] = useState<PerfilStaff | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [roteiro, setRoteiro] = useState<RoteiroEntrevista | null>(null);
  const [carregandoRoteiro, setCarregandoRoteiro] = useState(true);
  const [agenda, setAgenda] = useState<AgendaEntrevista | null>(null);
  const [dataHoraInput, setDataHoraInput] = useState("");
  const [scorecards, setScorecards] = useState<ScorecardRow[] | null>(null);
  const [carregandoScorecards, setCarregandoScorecards] = useState(true);
  const [notas, setNotas] = useState<Record<string, number>>({});
  const [comentarioScorecard, setComentarioScorecard] = useState('');
  const [erroScorecard, setErroScorecard] = useState<string | null>(null);

  useEffect(() => {
    function tratarFalha(e: unknown) {
      if (isErroDeAutenticacao(e)) {
        router.push('/staff/entrar');
        return;
      }
      setErro((e as Error).message);
    }
    staffPanelClient.obterRelatorioAssessment(params.id).then(setDados).catch(tratarFalha);
    staffPanelClient
      .obterCandidatura(params.id)
      .then((c) => {
        setCandidatura(c);
        if (c.etapaFunil === 'entrevista') {
          staffPanelClient
            .obterRoteiroEntrevista(c.jobId)
            .then(setRoteiro)
            .catch(() => {})
            .finally(() => setCarregandoRoteiro(false));
          staffPanelClient
            .obterAgendaEntrevista(params.id)
            .then((a) => {
              setAgenda(a);
              if (a) {
                staffPanelClient
                  .obterScorecards(a.id)
                  .then(setScorecards)
                  .catch(() => {})
                  .finally(() => setCarregandoScorecards(false));
              } else {
                setCarregandoScorecards(false);
              }
            })
            .catch(() => setCarregandoScorecards(false));
        } else {
          setCarregandoRoteiro(false);
        }
      })
      .catch(tratarFalha);
    staffPanelClient.obterPerfil().then(setPerfil).catch(() => {});
  }, [params.id, router]);

  function handleSair() {
    staffAuthClient.logout();
    router.push('/staff/entrar');
  }

  async function handleAgendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roteiro?.publishedVersionId || !perfil) return;
    try {
      await staffPanelClient.agendarEntrevista({
        applicationId: params.id,
        interviewGuideVersionId: roteiro.publishedVersionId,
        dataHora: new Date(dataHoraInput).toISOString(),
        avaliadorIds: [perfil.userId],
      });
      staffPanelClient.obterAgendaEntrevista(params.id).then(setAgenda).catch(() => {});
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function handleSubmeterScorecard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agenda) return;
    setErroScorecard(null);
    try {
      await staffPanelClient.submeterScorecard(agenda.id, {
        notasPorCompetencia: notas,
        comentario: comentarioScorecard || undefined,
      });
      staffPanelClient.obterScorecards(agenda.id).then(setScorecards).catch(() => {});
    } catch (e) {
      const mensagem = (e as Error).message;
      if (mensagem === 'Você já enviou sua avaliação para esta entrevista.') {
        staffPanelClient.obterScorecards(agenda.id).then(setScorecards).catch(() => {});
        return;
      }
      setErroScorecard(mensagem);
    }
  }

  const minhaAvaliacao = scorecards?.find((s) => s.avaliadorId === perfil?.userId) ?? null;

  const aderencia = dados?.aderencia ?? null;

  return (
    <PanelLayout nomeStaff={perfil?.email ?? ''} nomeTenant={perfil?.razaoSocial ?? ''} links={NAV_LINKS} onSair={handleSair}>
      <div className="max-w-2xl">
        <h1 className="font-display text-xl mb-4">Candidatura</h1>
        {erro && <p className="text-danger-text">{erro}</p>}
        <Card>
          {candidatura && (
            <div className="mb-4">
              <p className="font-display text-lg">{candidatura.person.nome}</p>
              <p className="font-ui text-sm text-text-secondary">Etapa atual: {candidatura.etapaFunil}</p>
            </div>
          )}
          {dados && (
            <ScoreChart
              scoreGeral={aderencia?.scoreAderencia != null ? aderencia.scoreAderencia / 100 : null}
              dimensoes={dados.relatorio?.secoes ?? []}
            />
          )}
          {aderencia && (aderencia.skillsBatidas.length > 0 || aderencia.skillsFaltantes.length > 0) && (
            <div className="mt-4 flex flex-col gap-2">
              <div>
                <p className="font-ui text-sm font-medium text-text">Skills atendidas</p>
                <p className="font-ui text-sm text-text-secondary">
                  {aderencia.skillsBatidas.length > 0 ? aderencia.skillsBatidas.join(', ') : 'Nenhuma'}
                </p>
              </div>
              <div>
                <p className="font-ui text-sm font-medium text-text">Skills faltantes</p>
                <p className="font-ui text-sm text-text-secondary">
                  {aderencia.skillsFaltantes.length > 0 ? aderencia.skillsFaltantes.join(', ') : 'Nenhuma'}
                </p>
              </div>
            </div>
          )}
        </Card>
        {candidatura?.etapaFunil === 'entrevista' && (
          <Card>
            <p className="font-ui text-sm font-medium text-text mb-2">Entrevista</p>
            {!carregandoRoteiro && !roteiro?.publishedVersionId && (
              <p className="font-ui text-sm text-text-secondary">
                Publique o roteiro de entrevista na vaga antes de agendar
              </p>
            )}
            {roteiro?.publishedVersionId && !agenda && (
              <form onSubmit={handleAgendar} className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 font-ui text-sm">
                  Data e hora
                  <input
                    type="datetime-local"
                    className="rounded-control px-3 py-2 border border-border bg-surface text-text"
                    value={dataHoraInput}
                    onChange={(e) => setDataHoraInput(e.target.value)}
                    required
                  />
                </label>
                <Button>Agendar entrevista</Button>
              </form>
            )}
            {agenda && (
              <p className="font-ui text-sm text-text">
                {new Date(agenda.dataHora).toLocaleString('pt-BR')} — {agenda.status}
              </p>
            )}
          </Card>
        )}
        {agenda && (
          <Card>
            <p className="font-ui text-sm font-medium text-text mb-2">Avaliação da entrevista</p>
            {carregandoScorecards && <p className="font-ui text-sm text-text-secondary">Carregando…</p>}
            {!carregandoScorecards && !minhaAvaliacao && erroScorecard === 'Você não é avaliador desta entrevista.' && (
              <p className="text-danger-text">{erroScorecard}</p>
            )}
            {!carregandoScorecards && !minhaAvaliacao && erroScorecard !== 'Você não é avaliador desta entrevista.' && (
              <form onSubmit={handleSubmeterScorecard} className="flex flex-col gap-4">
                {roteiro?.competencias.map((competencia) => (
                  <fieldset key={competencia.competencyId} className="flex flex-col gap-2">
                    <legend className="font-ui text-sm font-medium text-text">{competencia.nome}</legend>
                    {competencia.ancoras.map((ancora) => (
                      <label key={ancora.nivel} className="flex items-start gap-2 font-ui text-sm text-text-secondary">
                        <input
                          type="radio"
                          name={`competencia-${competencia.competencyId}`}
                          checked={notas[competencia.competencyId] === ancora.nivel}
                          onChange={() =>
                            setNotas((prev) => ({ ...prev, [competencia.competencyId]: ancora.nivel }))
                          }
                        />
                        {ancora.descricaoComportamental}
                      </label>
                    ))}
                  </fieldset>
                ))}
                <label className="flex flex-col gap-1 font-ui text-sm">
                  Comentário (opcional)
                  <textarea
                    className="rounded-control px-3 py-2 border border-border bg-surface text-text"
                    value={comentarioScorecard}
                    onChange={(e) => setComentarioScorecard(e.target.value)}
                  />
                </label>
                {erroScorecard && <p className="text-danger-text">{erroScorecard}</p>}
                <Button
                  disabled={!roteiro || !roteiro.competencias.every((c) => notas[c.competencyId] != null)}
                >
                  Enviar avaliação
                </Button>
              </form>
            )}
            {!carregandoScorecards && minhaAvaliacao && (
              <div className="flex flex-col gap-3">
                {roteiro?.competencias.map((competencia) => {
                  const nivel = minhaAvaliacao.notasPorCompetencia[competencia.competencyId];
                  const ancora = competencia.ancoras.find((a) => a.nivel === nivel);
                  return (
                    <div key={competencia.competencyId}>
                      <p className="font-ui text-sm font-medium text-text">{competencia.nome}</p>
                      <p className="font-ui text-sm text-text-secondary">
                        {ancora?.descricaoComportamental ?? `Nível ${nivel}`}
                      </p>
                    </div>
                  );
                })}
                {minhaAvaliacao.comentario && (
                  <div>
                    <p className="font-ui text-sm font-medium text-text">Comentário</p>
                    <p className="font-ui text-sm text-text-secondary">{minhaAvaliacao.comentario}</p>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </PanelLayout>
  );
}

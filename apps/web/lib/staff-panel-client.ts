'use client';

import { staffAuthClient } from './staff-auth-client';

export interface VagaResumo {
  id: string;
  titulo: string;
  publicadoEm: string | null;
  criadoEm: string;
  contagemCandidaturas: number;
}

export interface VagaCompleta {
  id: string;
  titulo: string;
  descricao: string;
  habilidadesExigidas: string[];
  publicadoEm: string | null;
  criadoEm: string;
  recrutadorIds: string[];
  instrumentVersionId: string | null;
}
export interface InstrumentoAtivo {  id: string;  nome: string;  versao: number;}

export interface PerfilStaff {
  userId: string;
  tenantId: string;
  roles: string[];
  email: string;
  razaoSocial: string;
}

export interface CriarVagaInput {
  requisitionId: string;
  titulo: string;
  habilidadesExigidas?: string[];
  recrutadorIds?: string[];
}

export interface CandidaturaResumo {
  id: string;
  personId: string;
  nomeCandidato: string;
  criadoEm: string;
  assessmentStatus: 'convidado' | 'iniciado' | 'concluido' | null;
  origemCanal: string | null;
  scoreAderencia: number | null;
}

export interface RespostaFunil {
  funil: Record<string, CandidaturaResumo[]>;
  conversao: Record<string, number | null>;
}

export interface CandidaturaDetalhe {
  id: string;
  jobId: string;
  etapaFunil: string;
  criadoEm: string;
  person: {
    id: string;
    nome: string;
    emailPrincipal: string;
  };
}

async function tratarResposta<T>(response: Response, mensagemErroPadrao: string): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? mensagemErroPadrao);
  }
  return response.json();
}

export interface RelatorioAssessment {
  relatorio: { secoes: { dimensao: string; titulo: string; estimativaTheta: number }[] } | null;
  aderencia: { scoreAderencia: number | null; skillsBatidas: string[]; skillsFaltantes: string[] } | null;
}

export interface AncoraComportamental {
  nivel: number;
  descricaoComportamental: string;
}

export interface CompetenciaComAncoras {
  competencyId: string;
  nome: string;
  ancoras: AncoraComportamental[];
}

export interface RoteiroEntrevista {
  id: string;
  status: 'rascunho' | 'publicado';
  competencias: CompetenciaComAncoras[];
  publishedVersionId: string | null;
}

export interface AgendaEntrevista {
  id: string;
  dataHora: string;
  status: 'agendada' | 'realizada' | 'cancelada';
}

export interface ScorecardRow {
  id: string;
  interviewScheduleId: string;
  avaliadorId: string;
  notasPorCompetencia: Record<string, number>;
  comentario: string | null;
  submetidoEm: string | null;
}

export interface OfferRow {
  id: string;
  applicationId: string;
  valor: string;
  moeda: string;
  status: 'estendida' | 'aceita' | 'recusada';
  estendidoPor: string;
  estendidoEm: string;
  respondidoPor: string | null;
  respondidoEm: string | null;
  motivoRecusaCodigo: string | null;
}

export interface JobDescriptionSuggestion {
  id: string;
  jobId: string;
  textoOriginal: string;
  textoSugerido: string;
  criadoEm: string;
}

export interface FraseResumo {
  texto: string;
  fonteId: string;
  secao: string;
  itemIndex: number;
  citacaoVerbatim: string;
}

export interface CandidateSummaryDraft {
  id: string;
  applicationId: string;
  frases: FraseResumo[];
  criadoEm: string;
}

export interface ItemPerguntaSugerida {
  competencyId: string;
  nome: string;
  perguntas: string[];
}

export interface InterviewQuestionSuggestion {
  id: string;
  interviewGuideVersionId: string;
  itens: ItemPerguntaSugerida[];
  criadoEm: string;
}

export interface ConexaoGoogleCalendar {
  connected: boolean;
  googleEmail?: string;
}

export interface DashboardMetricas {
  vagasAtivas: number;
  vagasRascunho: number;
  candidaturasEmAndamento: number;
  porEstagio: Record<string, number>;
}

export interface ImpactoAdversoRow {
  etapa: string;
  grupoDemografico: string;
  taxaSelecao: number;
  razao4Quintos: number;
  calculadoEm: string;
}

export const staffPanelClient = {
  async listarVagas(): Promise<VagaResumo[]> {
    const response = await staffAuthClient.authenticatedFetch('/v1/jobs');
    return tratarResposta(response, 'Não foi possível carregar as vagas');
  },

  async obterVaga(jobId: string): Promise<VagaCompleta> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/jobs/${jobId}`);
    return tratarResposta(response, 'Não foi possível carregar a vaga');
  },

  async criarVaga(input: CriarVagaInput): Promise<{ id: string }> {
    const response = await staffAuthClient.authenticatedFetch('/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return tratarResposta(response, 'Não foi possível criar a vaga');
  },

  async atribuirRecrutadores(jobId: string, recrutadorIds: string[]): Promise<void> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/jobs/${jobId}/actions/atribuir-recrutadores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recrutadorIds }),
    });
    await tratarResposta(response, 'Não foi possível atribuir recrutadores');
  },

  async editarVaga(jobId: string, input: { titulo?: string; descricao?: string; habilidadesExigidas?: string[]; instrumentVersionId?: string | null }): Promise<void> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    await tratarResposta(response, 'Não foi possível editar a vaga');
  },


  async obterInstrumentosAtivos(): Promise<InstrumentoAtivo[]> {
    const response = await staffAuthClient.authenticatedFetch('/v1/instrument-versions');
    return tratarResposta(response, 'Não foi possível carregar os instrumentos de assessment');
  },
  async obterFunil(jobId: string): Promise<RespostaFunil> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/jobs/${jobId}/funil`);
    return tratarResposta(response, 'Não foi possível carregar o funil');
  },

  async obterImpactoAdverso(jobId: string): Promise<ImpactoAdversoRow[]> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/jobs/${jobId}/adverse-impact`);
    return tratarResposta(response, 'Não foi possível carregar o impacto adverso');
  },

  async moverEtapa(applicationId: string, toState: string): Promise<void> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/applications/${applicationId}/actions/move-stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toState }),
    });
    await tratarResposta(response, 'Não foi possível mover a candidatura');
  },

  async obterRelatorioAssessment(applicationId: string): Promise<RelatorioAssessment> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/applications/${applicationId}/assessment-report`);
    return tratarResposta(response, 'Não foi possível carregar o relatório de assessment');
  },

  async obterCandidatura(applicationId: string): Promise<CandidaturaDetalhe> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/applications/${applicationId}`);
    return tratarResposta(response, 'Não foi possível carregar a candidatura');
  },

  async obterPerfil(): Promise<PerfilStaff> {
    const response = await staffAuthClient.authenticatedFetch('/v1/staff/auth/me');
    return tratarResposta(response, 'Não foi possível carregar o perfil');
  },

  async obterMetricas(): Promise<DashboardMetricas> {
    const response = await staffAuthClient.authenticatedFetch('/v1/jobs/dashboard-metrics');
    return tratarResposta(response, 'Não foi possível carregar as métricas');
  },

  async obterRoteiroEntrevista(jobId: string): Promise<RoteiroEntrevista | null> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/interview-guides/by-job/${jobId}`);
    if (response.status === 404) return null;
    return tratarResposta(response, 'Não foi possível carregar o roteiro de entrevista');
  },

  async gerarRoteiroEntrevista(input: { jobId: string; tituloVaga: string; textoRequisicao: string }): Promise<{ id: string }> {
    const response = await staffAuthClient.authenticatedFetch('/v1/interview-guides/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return tratarResposta(response, 'Não foi possível gerar o roteiro de entrevista');
  },

  async publicarRoteiroEntrevista(guideId: string): Promise<{ id: string; versao: number }> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/interview-guides/${guideId}/publish`, {
      method: 'POST',
    });
    return tratarResposta(response, 'Não foi possível publicar o roteiro de entrevista');
  },

  async obterAgendaEntrevista(applicationId: string): Promise<AgendaEntrevista | null> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/interview-schedules/by-application/${applicationId}`);
    if (response.status === 404) return null;
    return tratarResposta(response, 'Não foi possível carregar o agendamento');
  },

  async agendarEntrevista(input: { applicationId: string; interviewGuideVersionId: string; dataHora: string; avaliadorIds: string[] }): Promise<void> {
    const response = await staffAuthClient.authenticatedFetch('/v1/interview-schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    await tratarResposta(response, 'Não foi possível agendar a entrevista');
  },

  async obterScorecards(scheduleId: string): Promise<ScorecardRow[]> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/interview-schedules/${scheduleId}/scorecards`);
    return tratarResposta(response, 'Não foi possível carregar as avaliações da entrevista');
  },

  async submeterScorecard(
    scheduleId: string,
    input: { notasPorCompetencia: Record<string, number>; comentario?: string },
  ): Promise<void> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/interview-schedules/${scheduleId}/scorecards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (response.status === 403) throw new Error('Você não é avaliador desta entrevista.');
    if (response.status === 409) throw new Error('Você já enviou sua avaliação para esta entrevista.');
    await tratarResposta(response, 'Não foi possível enviar a avaliação');
  },

  async obterOfertas(applicationId: string): Promise<OfferRow[]> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/applications/${applicationId}/offers`);
    return tratarResposta(response, 'Não foi possível carregar as ofertas');
  },

  async estenderOferta(applicationId: string, input: { valor: string }): Promise<{ id: string }> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/applications/${applicationId}/actions/extend-offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (response.status === 409) throw new Error('Já existe uma oferta pendente para esta candidatura.');
    return tratarResposta(response, 'Não foi possível estender a oferta');
  },

  async aceitarOferta(offerId: string): Promise<{ id: string; applicationId: string }> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/offers/${offerId}/actions/accept`, { method: 'POST' });
    if (response.status === 409) throw new Error('Esta oferta já foi respondida.');
    return tratarResposta(response, 'Não foi possível registrar o aceite');
  },

  async recusarOferta(offerId: string, input: { motivoCodigo?: string }): Promise<{ id: string; applicationId: string }> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/offers/${offerId}/actions/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (response.status === 409) throw new Error('Esta oferta já foi respondida.');
    return tratarResposta(response, 'Não foi possível registrar a recusa');
  },

  async obterConexaoGoogleCalendar(): Promise<ConexaoGoogleCalendar> {
    const response = await staffAuthClient.authenticatedFetch('/v1/calendar-connections/google');
    return tratarResposta(response, 'Não foi possível verificar a conexão com o Google Calendar');
  },

  async obterUrlAutorizacaoGoogleCalendar(): Promise<{ url: string }> {
    const response = await staffAuthClient.authenticatedFetch('/v1/calendar-connections/google/auth-url');
    return tratarResposta(response, 'Não foi possível iniciar a conexão com o Google Calendar');
  },

  async desconectarGoogleCalendar(): Promise<void> {
    const response = await staffAuthClient.authenticatedFetch('/v1/calendar-connections/google', { method: 'DELETE' });
    await tratarResposta(response, 'Não foi possível desconectar o Google Calendar');
  },

  async gerarSugestaoDescricao(jobId: string): Promise<JobDescriptionSuggestion> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/jobs/${jobId}/description-suggestions`, { method: 'POST' });
    if (response.status === 503) throw new Error('Geração por IA indisponível no momento, tente novamente.');
    return tratarResposta(response, 'Não foi possível gerar a sugestão de descrição');
  },

  async aplicarSugestaoDescricao(jobId: string, suggestionId: string): Promise<{ descricao: string }> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/jobs/${jobId}/description-suggestions/${suggestionId}/apply`, { method: 'POST' });
    if (response.status === 409) throw new Error('A descrição da vaga mudou desde que esta sugestão foi gerada.');
    return tratarResposta(response, 'Não foi possível aplicar a sugestão');
  },

  async gerarResumoCandidato(applicationId: string): Promise<CandidateSummaryDraft> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/applications/${applicationId}/candidate-summary-drafts`, { method: 'POST' });
    if (response.status === 503) throw new Error('Geração por IA indisponível no momento, tente novamente.');
    if (response.status === 422) throw new Error('Não foi possível gerar um resumo citável para este candidato agora.');
    return tratarResposta(response, 'Não foi possível gerar o resumo do candidato');
  },

  async obterResumoCandidatoAtual(applicationId: string): Promise<CandidateSummaryDraft | null> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/applications/${applicationId}/candidate-summary-drafts/current`);
    if (response.status === 503) throw new Error('Geração por IA indisponível no momento, tente novamente.');
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? 'Não foi possível carregar o resumo do candidato');
    }
    const texto = await response.text();
    return texto ? (JSON.parse(texto) as CandidateSummaryDraft) : null;
  },

  async aplicarResumoCandidato(applicationId: string, draftId: string): Promise<{ id: string; aplicadoEm: string }> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/applications/${applicationId}/candidate-summary-drafts/${draftId}/apply`, { method: 'POST' });
    return tratarResposta(response, 'Não foi possível aplicar o resumo');
  },

  async gerarPerguntasEntrevista(versionId: string): Promise<InterviewQuestionSuggestion> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/interview-guide-versions/${versionId}/question-suggestions`, { method: 'POST' });
    if (response.status === 503) throw new Error('Geração por IA indisponível no momento, tente novamente.');
    return tratarResposta(response, 'Não foi possível gerar as perguntas sugeridas');
  },
};

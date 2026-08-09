'use client';

import { staffAuthClient } from './staff-auth-client';

export interface VagaResumo {
  id: string;
  titulo: string;
  publicadoEm: string | null;
  criadoEm: string;
}

export interface VagaCompleta {
  id: string;
  titulo: string;
  descricao: string;
  habilidadesExigidas: string[];
  publicadoEm: string | null;
  criadoEm: string;
  recrutadorIds: string[];
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

  async editarVaga(jobId: string, input: { titulo?: string; descricao?: string; habilidadesExigidas?: string[] }): Promise<void> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    await tratarResposta(response, 'Não foi possível editar a vaga');
  },

  async obterFunil(jobId: string): Promise<Record<string, CandidaturaResumo[]>> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/jobs/${jobId}/funil`);
    return tratarResposta(response, 'Não foi possível carregar o funil');
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
};

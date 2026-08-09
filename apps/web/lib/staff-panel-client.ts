'use client';

import { staffAuthClient } from './staff-auth-client';

export interface VagaResumo {
  id: string;
  titulo: string;
  publicadoEm: string | null;
  criadoEm: string;
}

export interface CriarVagaInput {
  requisitionId: string;
  titulo: string;
  habilidadesExigidas?: string[];
  recrutadorIds?: string[];
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
  async obterRelatorioAssessment(applicationId: string): Promise<RelatorioAssessment> {
    const response = await staffAuthClient.authenticatedFetch(`/v1/applications/${applicationId}/assessment-report`);
    return tratarResposta(response, 'Não foi possível carregar o relatório de assessment');
  },
};

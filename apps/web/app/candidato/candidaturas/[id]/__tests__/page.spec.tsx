import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import CandidaturaDetalhePage from '../page';
import { candidateAuthClient } from '../../../../../lib/candidate-auth-client';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'app-1' }),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('../../../../../lib/candidate-auth-client', () => ({
  candidateAuthClient: {
    isLoggedIn: vi.fn(() => true),
    authenticatedFetch: vi.fn(),
  },
}));

function mockResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: () => Promise.resolve(body) } as Response;
}

describe('CandidaturaDetalhePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra a linha do tempo de etapas percorridas', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch).mockResolvedValue(
      mockResponse(200, {
        applicationId: 'app-1',
        etapasPercorridas: [
          { deEtapa: null, paraEtapa: 'triagem', em: '2026-08-01T10:00:00Z' },
          { deEtapa: 'triagem', paraEtapa: 'entrevista', em: '2026-08-05T10:00:00Z' },
        ],
        decisao: null,
        oferta: null,
      }),
    );

    render(<CandidaturaDetalhePage />);

    await waitFor(() => expect(screen.getByText('triagem')).toBeInTheDocument());
    expect(screen.getByText('entrevista')).toBeInTheDocument();
  });

  it('nao mostra botao de revisao quando a decisao e aprovacao', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch).mockResolvedValue(
      mockResponse(200, {
        applicationId: 'app-1',
        etapasPercorridas: [],
        decisao: {
          tipo: 'aprovacao',
          motivoCodigo: null,
          decididoEm: '2026-08-10T10:00:00Z',
          revisaoSolicitada: false,
          revisaoSolicitadaEm: null,
          podeSolicitarRevisao: false,
        },
        oferta: null,
      }),
    );

    render(<CandidaturaDetalhePage />);

    await waitFor(() => expect(screen.getByText('aprovacao')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Solicitar revisão' })).not.toBeInTheDocument();
  });

  it('mostra botao de solicitar revisao quando reprovado e podeSolicitarRevisao', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch).mockResolvedValueOnce(
      mockResponse(200, {
        applicationId: 'app-1',
        etapasPercorridas: [],
        decisao: {
          tipo: 'reprovacao',
          motivoCodigo: 'perfil_nao_aderente',
          decididoEm: '2026-08-10T10:00:00Z',
          revisaoSolicitada: false,
          revisaoSolicitadaEm: null,
          podeSolicitarRevisao: true,
        },
        oferta: null,
      }),
    );

    render(<CandidaturaDetalhePage />);

    await waitFor(() => expect(screen.getByText('perfil_nao_aderente')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Solicitar revisão' })).toBeInTheDocument();
  });

  it('clicar em solicitar revisao chama o endpoint e recarrega a view', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch)
      .mockResolvedValueOnce(
        mockResponse(200, {
          applicationId: 'app-1',
          etapasPercorridas: [],
          decisao: {
            tipo: 'reprovacao',
            motivoCodigo: 'perfil_nao_aderente',
            decididoEm: '2026-08-10T10:00:00Z',
            revisaoSolicitada: false,
            revisaoSolicitadaEm: null,
            podeSolicitarRevisao: true,
          },
          oferta: null,
        }),
      )
      .mockResolvedValueOnce(mockResponse(200, { id: 'decision-1' }))
      .mockResolvedValueOnce(
        mockResponse(200, {
          applicationId: 'app-1',
          etapasPercorridas: [],
          decisao: {
            tipo: 'reprovacao',
            motivoCodigo: 'perfil_nao_aderente',
            decididoEm: '2026-08-10T10:00:00Z',
            revisaoSolicitada: true,
            revisaoSolicitadaEm: '2026-08-11T09:00:00Z',
            podeSolicitarRevisao: false,
          },
          oferta: null,
        }),
      );

    render(<CandidaturaDetalhePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Solicitar revisão' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar revisão' }));

    await waitFor(() =>
      expect(candidateAuthClient.authenticatedFetch).toHaveBeenCalledWith(
        '/v1/candidate/applications/app-1/actions/solicitar-revisao',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/Revisão solicitada/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Solicitar revisão' })).not.toBeInTheDocument();
  });

  it('mostra a oferta quando presente', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch).mockResolvedValue(
      mockResponse(200, {
        applicationId: 'app-1',
        etapasPercorridas: [],
        decisao: null,
        oferta: {
          status: 'estendida',
          valor: '8500.00',
          moeda: 'BRL',
          estendidoEm: '2026-08-10T10:00:00Z',
          respondidoEm: null,
        },
      }),
    );

    render(<CandidaturaDetalhePage />);

    await waitFor(() => expect(screen.getByText('estendida')).toBeInTheDocument());
  });

  it('mostra mensagem generica quando a candidatura nao e do candidato (404)', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch).mockResolvedValue(mockResponse(404, { message: 'Não encontrada' }));

    render(<CandidaturaDetalhePage />);

    await waitFor(() => expect(screen.getByText('Candidatura não encontrada.')).toBeInTheDocument());
  });
});

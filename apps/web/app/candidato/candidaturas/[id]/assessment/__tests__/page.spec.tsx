import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AssessmentPage from '../page';
import { candidateAuthClient } from '../../../../../../lib/candidate-auth-client';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'app-1' }),
  useRouter: () => ({ push: pushMock }),
}));
vi.mock('../../../../../../lib/candidate-auth-client', () => ({
  candidateAuthClient: {
    isLoggedIn: vi.fn(() => true),
    authenticatedFetch: vi.fn(),
  },
}));

function mockResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: () => Promise.resolve(body) } as Response;
}

describe('AssessmentPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra o bloco atual com os 2 itens e o progresso', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch).mockResolvedValue(
      mockResponse(200, {
        blockId: 'b-5',
        itens: [
          { itemId: 'i-1', texto: 'Gosto de planejar meu dia com antecedência' },
          { itemId: 'i-2', texto: 'Prefiro agir por impulso' },
        ],
        progresso: { atual: 4, total: 20 },
      }),
    );

    render(<AssessmentPage />);

    await waitFor(() => expect(screen.getByText('Bloco 5 de 20')).toBeInTheDocument());
    expect(screen.getByText('Gosto de planejar meu dia com antecedência')).toBeInTheDocument();
    expect(screen.getByText('Prefiro agir por impulso')).toBeInTheDocument();
  });

  it('desabilita o botao proximo ate mais e menos estarem escolhidos, em itens diferentes', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch).mockResolvedValue(
      mockResponse(200, {
        blockId: 'b-1',
        itens: [
          { itemId: 'i-1', texto: 'Item 1' },
          { itemId: 'i-2', texto: 'Item 2' },
        ],
        progresso: { atual: 0, total: 20 },
      }),
    );

    render(<AssessmentPage />);
    await waitFor(() => expect(screen.getByText('Item 1')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Próximo' })).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Item 1 — Mais parecido comigo'));
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Item 2 — Menos parecido comigo'));
    expect(screen.getByRole('button', { name: 'Próximo' })).not.toBeDisabled();
  });

  it('envia a resposta e carrega o proximo bloco', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch)
      .mockResolvedValueOnce(
        mockResponse(200, {
          blockId: 'b-1',
          itens: [
            { itemId: 'i-1', texto: 'Item 1' },
            { itemId: 'i-2', texto: 'Item 2' },
          ],
          progresso: { atual: 0, total: 20 },
        }),
      )
      .mockResolvedValueOnce(mockResponse(200, { concluido: false }))
      .mockResolvedValueOnce(
        mockResponse(200, {
          blockId: 'b-2',
          itens: [
            { itemId: 'i-3', texto: 'Item 3' },
            { itemId: 'i-4', texto: 'Item 4' },
          ],
          progresso: { atual: 1, total: 20 },
        }),
      );

    render(<AssessmentPage />);
    await waitFor(() => expect(screen.getByText('Item 1')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Item 1 — Mais parecido comigo'));
    fireEvent.click(screen.getByLabelText('Item 2 — Menos parecido comigo'));
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));

    await waitFor(() =>
      expect(candidateAuthClient.authenticatedFetch).toHaveBeenCalledWith(
        '/v1/candidate/applications/app-1/assessment/blocks/b-1/answer',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ itemIds: ['i-1', 'i-2'], maisId: 'i-1', menosId: 'i-2' }),
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText('Item 3')).toBeInTheDocument());
  });

  it('mostra a tela de agradecimento quando o ultimo bloco e respondido', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch)
      .mockResolvedValueOnce(
        mockResponse(200, {
          blockId: 'b-20',
          itens: [
            { itemId: 'i-39', texto: 'Item 39' },
            { itemId: 'i-40', texto: 'Item 40' },
          ],
          progresso: { atual: 19, total: 20 },
        }),
      )
      .mockResolvedValueOnce(mockResponse(200, { concluido: true }));

    render(<AssessmentPage />);
    await waitFor(() => expect(screen.getByText('Item 39')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Item 39 — Mais parecido comigo'));
    fireEvent.click(screen.getByLabelText('Item 40 — Menos parecido comigo'));
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));

    await waitFor(() => expect(screen.getByText('Obrigado, sua resposta foi registrada.')).toBeInTheDocument());
    expect(screen.queryByText(/theta|score|percentil/i)).not.toBeInTheDocument();
  });

  it('mostra a tela de agradecimento direto se o assessment ja estava concluido ao abrir a pagina', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch).mockResolvedValue(mockResponse(200, { concluido: true }));

    render(<AssessmentPage />);

    await waitFor(() => expect(screen.getByText('Obrigado, sua resposta foi registrada.')).toBeInTheDocument());
  });

  it('mostra todos os itens de um bloco de 3, nao so os 2 primeiros (achado do LIMIT 2 fixo)', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch).mockResolvedValue(
      mockResponse(200, {
        blockId: 'b-1',
        itens: [
          { itemId: 'i-1', texto: 'Item 1' },
          { itemId: 'i-2', texto: 'Item 2' },
          { itemId: 'i-3', texto: 'Item 3' },
        ],
        progresso: { atual: 0, total: 20 },
      }),
    );

    render(<AssessmentPage />);

    await waitFor(() => expect(screen.getByText('Item 1')).toBeInTheDocument());
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('Item 3')).toBeInTheDocument();
  });

  it('mostra botao "Tentar novamente" quando o carregamento falha, e ele recarrega o bloco atual', async () => {
    vi.mocked(candidateAuthClient.authenticatedFetch)
      .mockResolvedValueOnce(mockResponse(500, { message: 'erro interno' }))
      .mockResolvedValueOnce(
        mockResponse(200, {
          blockId: 'b-1',
          itens: [
            { itemId: 'i-1', texto: 'Item 1' },
            { itemId: 'i-2', texto: 'Item 2' },
          ],
          progresso: { atual: 0, total: 20 },
        }),
      );

    render(<AssessmentPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument());
    expect(candidateAuthClient.authenticatedFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => expect(screen.getByText('Item 1')).toBeInTheDocument());
    expect(candidateAuthClient.authenticatedFetch).toHaveBeenCalledTimes(2);
  });
});

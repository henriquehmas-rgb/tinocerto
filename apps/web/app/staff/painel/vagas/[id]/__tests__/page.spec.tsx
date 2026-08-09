import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FunilPage from '../page';
import { staffPanelClient } from '../../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
const routerMock = { push: pushMock };
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'job-1' }), useRouter: () => routerMock }));
vi.mock('../../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: { obterFunil: vi.fn(), moverEtapa: vi.fn() },
}));

describe('FunilPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renderiza as colunas do funil com as candidaturas carregadas', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      triagem: [{ id: 'app-1', personId: 'person-1', nomeCandidato: 'Ana', criadoEm: '2026-08-01T00:00:00Z' }],
      entrevista: [],
    });
    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
  });

  it('move uma candidatura de etapa e recarrega o funil', async () => {
    vi.mocked(staffPanelClient.obterFunil)
      .mockResolvedValueOnce({
        triagem: [{ id: 'app-1', personId: 'person-1', nomeCandidato: 'Ana', criadoEm: '2026-08-01T00:00:00Z' }],
        entrevista: [],
      })
      .mockResolvedValueOnce({
        triagem: [],
        entrevista: [{ id: 'app-1', personId: 'person-1', nomeCandidato: 'Ana', criadoEm: '2026-08-01T00:00:00Z' }],
      });
    vi.mocked(staffPanelClient.moverEtapa).mockResolvedValue(undefined);
    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /mover ana/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Entrevista' }));

    await waitFor(() =>
      expect(staffPanelClient.moverEtapa).toHaveBeenCalledWith('app-1', 'entrevista'),
    );
    expect(staffPanelClient.obterFunil).toHaveBeenCalledTimes(2);
  });

  it('renderiza um link para editar a vaga apontando para a rota correta', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({ triagem: [], entrevista: [] });
    render(<FunilPage />);
    const link = await screen.findByRole('link', { name: 'Editar vaga' });
    expect(link).toHaveAttribute('href', '/staff/painel/vagas/job-1/editar');
  });

  it('deriva as colunas dinamicamente do funil, mostrando etapas fora da lista fixa antiga', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockResolvedValue({
      triagem: [],
      oferta: [{ id: 'app-2', personId: 'person-2', nomeCandidato: 'Bruno', criadoEm: '2026-08-01T00:00:00Z' }],
    });
    render(<FunilPage />);
    await waitFor(() => expect(screen.getByText('Bruno')).toBeInTheDocument());
    expect(screen.getByText('Oferta')).toBeInTheDocument();
  });

  it('redireciona para /staff/entrar quando o carregamento do funil falha por sessão ausente', async () => {
    vi.mocked(staffPanelClient.obterFunil).mockRejectedValue(new Error('Usuário não autenticado'));
    render(<FunilPage />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/staff/entrar'));
  });
});

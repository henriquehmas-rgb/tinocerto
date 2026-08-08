import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditarVagaPage from '../page';
import { staffPanelClient } from '../../../../../../../lib/staff-panel-client';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }), useParams: () => ({ id: 'job-1' }) }));
vi.mock('../../../../../../../lib/staff-panel-client', () => ({
  staffPanelClient: { editarVaga: vi.fn(), atribuirRecrutadores: vi.fn() },
}));

describe('EditarVagaPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submete título, habilidades e recrutadores, e navega para o funil ao salvar', async () => {
    vi.mocked(staffPanelClient.editarVaga).mockResolvedValue(undefined);
    vi.mocked(staffPanelClient.atribuirRecrutadores).mockResolvedValue(undefined);
    render(<EditarVagaPage />);

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Engenheiro de Dados Sênior' } });
    fireEvent.change(screen.getByLabelText('Habilidades exigidas (separadas por vírgula)'), {
      target: { value: 'SQL, Python' },
    });
    fireEvent.change(screen.getByLabelText('IDs dos recrutadores (separados por vírgula)'), {
      target: { value: 'r1, r2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(staffPanelClient.editarVaga).toHaveBeenCalledWith('job-1', {
        titulo: 'Engenheiro de Dados Sênior',
        descricao: undefined,
        habilidadesExigidas: ['SQL', 'Python'],
      }),
    );
    expect(staffPanelClient.atribuirRecrutadores).toHaveBeenCalledWith('job-1', ['r1', 'r2']);
    expect(pushMock).toHaveBeenCalledWith('/staff/painel/vagas/job-1');
  });

  it('mostra erro quando editarVaga falha', async () => {
    vi.mocked(staffPanelClient.editarVaga).mockRejectedValue(new Error('Vaga não encontrada'));
    render(<EditarVagaPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.getByText('Vaga não encontrada')).toBeInTheDocument());
  });
});
